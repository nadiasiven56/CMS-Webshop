/**
 * Storefront checkout.
 *
 *   POST /cart/:token/checkout
 *
 * Flow (alles binnen 1 transactie via runInTransactionWithAudit):
 *   1. Laad cart + regels (moet bij deze shop horen, niet leeg).
 *   2. Voorraad-her-check per regel (race-safe binnen tx).
 *   3. Upsert customer op UNIQUE(shop_id, email).
 *   4. Genereer per-shop order_number (CR-1001-stijl op shop-prefix).
 *   5. Maak order + order_items (prijs/btw/marge gesnapshot).
 *   6. Payment mock → order_payments(status='paid') + order.financial_status='paid'.
 *   7. Decrement available-voorraad (verkocht).
 *   8. Update customer-aggregaten (orders_count, total_spent).
 *   9. Audit-row.
 *   10. Cart legen.
 *
 * Geld = string (Money-helper). Geen float-berekeningen die teruggeschreven worden.
 */
import type { Context } from 'hono';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import {
  carts,
  cartItems,
  variants,
  products,
  shopProducts,
  customers,
  orders,
  orderItems,
  orderPayments,
  inventoryItems,
  inventoryLevels,
  type Shop,
} from '../../db/schema/index.js';
import { money } from '@webshop-crm/shared/types/money';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import type { DbOrTx } from '../../domain/stock/available-recompute.js';
import { effectivePrice } from './_pricing.js';
import { postOrderRevenue } from '../../domain/finance/ledger-posting.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../lib/env.js';
import { getPaymentProvider } from '../../domain/payments/index.js';
import { toAmountValue, isPaymentNotConnectedError } from '../../domain/payments/types.js';
import {
  validateDiscountCode,
  recordDiscountRedemption,
} from '../../domain/discounts/validate.js';
import { fireOrderCreated, fireOrderPaid } from '../../domain/orchestration/order-events.js';
import { splitVat } from '../../domain/finance/vat-math.js';
import { nextOrderNumber as nextOrderNumberForShop } from '../../domain/orders/order-number.js';

/**
 * Toegestane order-channels (matcht orders.channel comment: web | bol | amazon | gmc).
 * Storefront-verkopen zijn standaard 'web' (eigen webshop). De channel kan
 * desgewenst expliciet meegegeven worden via ?channel= (bv. wanneer een
 * marketplace-bridge via dezelfde checkout-flow boekt).
 */
const ALLOWED_CHANNELS = ['web', 'bol', 'amazon', 'gmc'] as const;
type OrderChannel = (typeof ALLOWED_CHANNELS)[number];

/**
 * Bepaal het channel voor deze storefront-order. Eigen-webshop-verkopen
 * worden correct als 'web' getagd; een geldige ?channel=-override wint.
 * Onbekende waarden vallen terug op 'web'.
 */
function resolveChannel(c: Context): OrderChannel {
  const q = c.req.query('channel')?.trim().toLowerCase();
  if (q && (ALLOWED_CHANNELS as readonly string[]).includes(q)) {
    return q as OrderChannel;
  }
  return 'web';
}

const AddressSchema = z.object({
  name: z.string().trim().min(1).optional(),
  company: z.string().trim().optional(),
  line1: z.string().trim().min(1),
  line2: z.string().trim().optional(),
  postcode: z.string().trim().min(1),
  city: z.string().trim().min(1),
  province: z.string().trim().optional(),
  country: z.string().trim().length(2).optional().default('NL'),
  phone: z.string().trim().optional(),
});

const CheckoutSchema = z.object({
  email: z.string().email(),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  phone: z.string().trim().optional(),
  company: z.string().trim().optional(),
  vatNumber: z.string().trim().optional(),
  acceptsMarketing: z.boolean().optional().default(false),
  note: z.string().trim().max(2000).optional(),
  shippingAddress: AddressSchema,
  // Geen billing → gebruik shipping.
  billingAddress: AddressSchema.optional(),
  shippingTotal: z.string().regex(/^\d+(\.\d{1,4})?$/).optional().default('0'),
  // Optionele kortingscode. Afwezig → checkout-gedrag byte-voor-byte ongewijzigd.
  discountCode: z.string().trim().min(1).optional(),
});

/** Decimal-string (numeric(12,4)) → integer centen, float-vrij genoeg voor money. */
function moneyToCents(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Integer centen → numeric(12,4) decimal-string. */
function centsToDecimal(cents: number): string {
  return (Math.max(0, Math.trunc(cents)) / 100).toFixed(4);
}

export async function checkout(c: Context): Promise<Response> {
  const shop = c.get('shop') as Shop;
  const token = c.req.param('token');
  const channel = resolveChannel(c);

  const body = await c.req.json().catch(() => null);
  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  // Cart + regels buiten tx ophalen voor snelle validatie (re-check in tx).
  const [cart] = await db
    .select()
    .from(carts)
    .where(and(eq(carts.token, token), eq(carts.shopId, shop.id)))
    .limit(1);
  if (!cart) return c.json({ error: 'cart_not_found' }, 404);

  const lineRows = await db
    .select({
      cartItemId: cartItems.id,
      variantId: cartItems.variantId,
      quantity: cartItems.quantity,
      unitPriceSnapshot: cartItems.unitPrice,
      variantSku: variants.sku,
      variantPrice: variants.price,
      variantCost: variants.costPrice,
      variantTaxClass: variants.taxClass,
      productId: variants.productId,
      productTitle: products.title,
    })
    .from(cartItems)
    .innerJoin(variants, eq(variants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(cartItems.cartId, cart.id))
    .orderBy(asc(cartItems.id));

  if (lineRows.length === 0) {
    return c.json({ error: 'cart_empty' }, 422);
  }

  // price_override per product (publicatie-check + prijs).
  const productIds = [...new Set(lineRows.map((r) => r.productId))];
  const shopProductRows = await db
    .select({
      productId: shopProducts.productId,
      published: shopProducts.published,
      priceOverride: shopProducts.priceOverride,
    })
    .from(shopProducts)
    .where(
      and(
        eq(shopProducts.shopId, shop.id),
        inArray(shopProducts.productId, productIds),
      ),
    );
  const shopProductByProduct = new Map(
    shopProductRows.map((r) => [r.productId, r]),
  );

  // Alle regels moeten gepubliceerd zijn in deze shop.
  for (const r of lineRows) {
    const sp = shopProductByProduct.get(r.productId);
    if (!sp || !sp.published) {
      return c.json(
        { error: 'line_not_available', variantId: r.variantId },
        422,
      );
    }
  }

  // inventory_item per variant (voor voorraad-check + decrement).
  const variantIds = lineRows.map((r) => r.variantId);
  const invItems = await db
    .select({
      variantId: inventoryItems.variantId,
      itemId: inventoryItems.id,
      tracked: inventoryItems.tracked,
    })
    .from(inventoryItems)
    .where(inArray(inventoryItems.variantId, variantIds));
  const invItemByVariant = new Map(invItems.map((i) => [i.variantId, i]));

  // Bereken totalen (Money).
  const VAT_BY_CLASS: Record<string, number> = {
    standard: 21,
    reduced: 9,
    zero: 0,
    exempt: 0,
  };

  // Storefront-prijzen zijn BRUTO (incl. btw). Per regel splitsen we de
  // ingesloten btw eruit IN HELE CENTEN (geen float-drift) zodat order.subtotal
  // NETTO is en order.taxTotal de btw — exact wat het grootboek (revenue =
  // netto, vat_payable = btw) leest. net+btw blijft exact gelijk aan het bruto
  // bedrag dat de klant ziet en betaalt (geen afrond-lek).
  let subtotalNetCents = 0;
  let taxCents = 0;
  const orderItemsToInsert: Array<{
    variantId: string;
    sku: string | null;
    title: string | null;
    quantity: number;
    unitPrice: string;
    taxRate: string;
    taxAmount: string;
    costPrice: string | null;
    lineTotal: string;
  }> = [];

  for (const r of lineRows) {
    const sp = shopProductByProduct.get(r.productId)!;
    const grossUnit = effectivePrice(
      { price: r.variantPrice },
      sp.priceOverride ?? null,
    );
    const taxRate = VAT_BY_CLASS[r.variantTaxClass] ?? 21;
    const grossLineCents = moneyToCents(grossUnit) * r.quantity;
    const { netCents, vatCents } = splitVat(grossLineCents, taxRate, true);
    subtotalNetCents += netCents;
    taxCents += vatCents;
    // unitPrice = netto stuksprijs (admin-conventie); lineTotal = bruto regel.
    const netUnitCents = r.quantity > 0 ? Math.round(netCents / r.quantity) : netCents;
    orderItemsToInsert.push({
      variantId: r.variantId,
      sku: r.variantSku,
      title: r.productTitle,
      quantity: r.quantity,
      unitPrice: centsToDecimal(netUnitCents),
      taxRate: String(taxRate),
      taxAmount: centsToDecimal(vatCents),
      costPrice: r.variantCost,
      lineTotal: centsToDecimal(grossLineCents),
    });
  }

  let shippingTotal = money(input.shippingTotal);

  // ── Optionele kortingscode ──
  // Afwezig → discountTotal blijft '0'. Aanwezig → valideer in centen tegen het
  // NETTO subtotaal; ongeldig = 400 (geen order). De redemption wordt BINNEN de
  // order-tx geschreven (idempotent op (discount, order)) zodat een rollback ook
  // de redemption terugdraait.
  let discountTotal = money(0);
  let appliedDiscount: { id: string; appliedCents: number; freeShipping: boolean } | null = null;
  if (input.discountCode) {
    const shippingCents = moneyToCents(shippingTotal);
    const validation = await validateDiscountCode(input.discountCode, {
      shopId: shop.id,
      subtotalCents: subtotalNetCents,
      currency: shop.currency,
      customerEmail: input.email,
      shippingCents,
    });
    if (!validation.ok) {
      return c.json(
        {
          error: 'invalid_discount',
          reason: validation.reason,
          message: validation.message,
        },
        400,
      );
    }
    // free_shipping → verzending wordt gratis; anders → korting op subtotaal.
    if (validation.freeShipping) {
      shippingTotal = money(0);
    }
    discountTotal = money(centsToDecimal(validation.discountCents));
    appliedDiscount = {
      id: validation.discount.id,
      appliedCents: validation.discountCents,
      freeShipping: validation.freeShipping,
    };
  }

  // Totalen (alles in centen): grand_total = subtotal(netto) + btw + verzending −
  // korting, nooit negatief.
  const subtotal = money(centsToDecimal(subtotalNetCents));
  const taxTotal = money(centsToDecimal(taxCents));
  const grandCents =
    subtotalNetCents + taxCents + moneyToCents(shippingTotal) - moneyToCents(discountTotal);
  const grandTotal = money(centsToDecimal(Math.max(0, grandCents)));

  // ── Payment-provider resolutie (Wave-H A4) ──
  // Heeft deze shop een geconfigureerde PSP (bv. Mollie) + sleutel? Zo niet →
  // `getPaymentProvider` geeft null en we houden EXACT het mock-paid-pad
  // (order direct paid + ledger geboekt). Zo wél → order wordt pending_payment,
  // GEEN ledger, en we maken na de tx een echte PSP-betaling aan.
  const paymentProvider = getPaymentProvider(shop);
  const usePsp = paymentProvider !== null;

  try {
    const result = await runInTransactionWithAudit(async (tx, audit) => {
      // ── Voorraad-her-check + decrement binnen tx ──
      for (const r of lineRows) {
        const inv = invItemByVariant.get(r.variantId);
        if (!inv || !inv.tracked) continue; // untracked = oneindig
        const levels = await tx
          .select({
            id: inventoryLevels.id,
            available: inventoryLevels.available,
          })
          .from(inventoryLevels)
          .where(eq(inventoryLevels.itemId, inv.itemId))
          .orderBy(asc(inventoryLevels.id))
          // Lock de voorraadrijen voor de duur van de tx → gelijktijdige
          // checkouts op dezelfde variant serialiseren i.p.v. te oversellen.
          .for('update');
        const totalAvailable = levels.reduce((acc, l) => acc + l.available, 0);
        if (totalAvailable < r.quantity) {
          throw new InsufficientStockError(r.variantId, totalAvailable, r.quantity);
        }
        // Decrement available greedy over locations.
        let remaining = r.quantity;
        for (const l of levels) {
          if (remaining <= 0) break;
          const take = Math.min(l.available, remaining);
          if (take > 0) {
            await tx
              .update(inventoryLevels)
              .set({
                available: l.available - take,
                committed: sql`${inventoryLevels.committed} + ${take}`,
                updatedAt: new Date(),
              })
              .where(eq(inventoryLevels.id, l.id));
            remaining -= take;
          }
        }
      }

      // ── Customer upsert op UNIQUE(shop_id, email) ──
      const [customer] = await tx
        .insert(customers)
        .values({
          shopId: shop.id,
          email: input.email,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          phone: input.phone ?? null,
          company: input.company ?? null,
          vatNumber: input.vatNumber ?? null,
          acceptsMarketing: input.acceptsMarketing,
        })
        .onConflictDoUpdate({
          target: [customers.shopId, customers.email],
          set: {
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            phone: input.phone ?? null,
            company: input.company ?? null,
            vatNumber: input.vatNumber ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();

      // ── Per-shop order_number ──
      const orderNumber = await nextOrderNumber(tx, shop);

      // ── Order ──
      const billing = input.billingAddress ?? input.shippingAddress;
      const [order] = await tx
        .insert(orders)
        .values({
          shopId: shop.id,
          orderNumber,
          customerId: customer!.id,
          email: input.email,
          channel,
          // PSP-flow: order wacht op betaling. Mock-flow: direct paid (huidig gedrag).
          status: usePsp ? 'pending' : 'paid',
          financialStatus: usePsp ? 'pending_payment' : 'paid',
          fulfillmentStatus: 'unfulfilled',
          currency: shop.currency,
          subtotal,
          discountTotal,
          shippingTotal,
          taxTotal,
          grandTotal,
          billingAddress: billing,
          shippingAddress: input.shippingAddress,
          note: input.note ?? null,
          placedAt: new Date(),
        })
        .returning();

      // ── Order items ──
      await tx.insert(orderItems).values(
        orderItemsToInsert.map((it) => ({
          orderId: order!.id,
          variantId: it.variantId,
          sku: it.sku,
          title: it.title,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          taxRate: it.taxRate,
          taxAmount: it.taxAmount,
          costPrice: it.costPrice,
          lineTotal: it.lineTotal,
        })),
      );

      // ── Discount-redemption (idempotent op (discount, order)) ──
      // Binnen de tx zodat een rollback ook de redemption + times_redeemed-bump
      // terugdraait. Alleen wanneer er een geldige code is toegepast.
      if (appliedDiscount) {
        await recordDiscountRedemption(tx, appliedDiscount.id, {
          orderId: order!.id,
          customerEmail: input.email,
          amountAppliedCents: appliedDiscount.appliedCents,
        });
      }

      // ── Payment ──
      // PSP-flow: pending betaling, reference wordt NA de tx gevuld met de
      // PSP-payment-id (de webhook matcht hierop). Mock-flow: direct paid.
      const [payment] = await tx
        .insert(orderPayments)
        .values(
          usePsp
            ? {
                orderId: order!.id,
                provider: paymentProvider!.provider, // 'mollie'
                amount: grandTotal,
                status: 'pending',
                reference: null,
                paidAt: null,
              }
            : {
                orderId: order!.id,
                provider: 'mock',
                amount: grandTotal,
                status: 'paid',
                reference: `MOCK-${orderNumber}`,
                paidAt: new Date(),
              },
        )
        .returning();

      // ── Customer-aggregaten ──
      // ordersCount telt de plaatsing altijd; totalSpent (omzet) bumpen we alleen
      // bij directe betaling (mock). Bij PSP-flow telt de omzet pas wanneer de
      // webhook de order op 'paid' zet (samen met de ledger-boeking).
      await tx
        .update(customers)
        .set({
          ordersCount: sql`${customers.ordersCount} + 1`,
          totalSpent: usePsp
            ? sql`${customers.totalSpent}`
            : sql`${customers.totalSpent} + ${grandTotal}`,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customer!.id));

      // ── Ledger ──
      // Mock-flow (order direct betaald): boek de omzet meteen. Idempotent.
      // De storefront-verkoop levert direct gebalanceerde double-entry-regels op
      // (trade_debtors / revenue / vat_payable [+ cogs/inventory]).
      // PSP-flow: NIET boeken — de webhook doet postOrderRevenue bij 'paid'.
      if (!usePsp) {
        await postOrderRevenue(
          tx,
          order!,
          orderItemsToInsert.map((it) => ({
            quantity: it.quantity,
            costPrice: it.costPrice,
            taxRate: it.taxRate,
          })),
        );
      }

      // ── Cart legen (afgerekend) ──
      await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));

      // ── Audit ──
      audit.set({
        actor: { type: 'api', id: null },
        action: 'create',
        entityType: 'order',
        entityId: order!.id,
        before: null,
        after: {
          orderNumber,
          shopId: shop.id,
          customerId: customer!.id,
          email: input.email,
          grandTotal,
          itemCount: orderItemsToInsert.length,
          source: 'storefront_checkout',
        },
        ip: c.req.header('x-forwarded-for') ?? null,
      });

      return { order: order!, payment: payment!, customerId: customer!.id };
    });

    const orderDto = {
      id: result.order.id,
      orderNumber: result.order.orderNumber,
      status: result.order.status,
      financialStatus: result.order.financialStatus,
      currency: result.order.currency,
      subtotal: result.order.subtotal,
      discountTotal: result.order.discountTotal,
      shippingTotal: result.order.shippingTotal,
      taxTotal: result.order.taxTotal,
      grandTotal: result.order.grandTotal,
      email: result.order.email,
      placedAt: result.order.placedAt
        ? result.order.placedAt.toISOString()
        : null,
      createdAt: result.order.createdAt.toISOString(),
    };

    // ── Side-effects (koppel-klaar; fire-and-forget, NA de tx) ──
    // order.created vuurt altijd. In de mock-flow is de order meteen 'paid', dus
    // sturen we ook de bevestigingsmail + order.paid hier (precies één keer per
    // order). In de PSP-flow blijft de order 'pending' → order.paid + mail lopen
    // later via de payments-webhook, dus hier NIET mailen.
    const nameParts = { firstName: input.firstName, lastName: input.lastName };
    void fireOrderCreated(result.order);
    if (!usePsp) {
      void fireOrderPaid(result.order, { name: nameParts });
    }

    // ── PSP-flow (Wave-H A4): maak de echte betaling NA de tx ──
    // De DB-tx is gecommit (order = pending_payment, stock vastgelegd). We
    // praten nu pas met de PSP (geen netwerk-call met open DB-tx). Lukt het, dan
    // slaan we de PSP-payment-id op in order_payments.reference (de webhook
    // matcht hierop) en geven we de checkout-URL terug voor de redirect.
    if (usePsp && paymentProvider) {
      try {
        const created = await paymentProvider.createPayment({
          amountValue: toAmountValue(grandTotal),
          currency: result.order.currency,
          description: `Order ${result.order.orderNumber}`,
          orderId: result.order.id,
          redirectUrl: buildRedirectUrl(c, shop, result.order.orderNumber),
          webhookUrl: buildWebhookUrl(paymentProvider.provider),
        });

        // Koppel de PSP-payment-id aan de pending payment-row.
        await db
          .update(orderPayments)
          .set({ reference: created.providerPaymentId })
          .where(eq(orderPayments.id, result.payment.id));

        logger.info(
          {
            orderId: result.order.id,
            provider: paymentProvider.provider,
            providerPaymentId: created.providerPaymentId,
          },
          'storefront checkout: PSP payment created',
        );

        return c.json(
          {
            order: orderDto,
            payment: {
              provider: paymentProvider.provider,
              status: created.status, // 'open'
              checkoutUrl: created.checkoutUrl,
              amount: result.payment.amount,
            },
          },
          201,
        );
      } catch (err) {
        // Guard: zonder sleutel vuurt er niets — dat geeft een typed not-connected.
        if (isPaymentNotConnectedError(err)) {
          return c.json(
            {
              error: 'channel_not_connected',
              message: 'Mollie credentials required',
            },
            409,
          );
        }
        // PSP-fout: de order blijft pending_payment (stock al vastgelegd). De
        // storefront kan retry'en / de operator kan de order opvolgen.
        logger.error(
          { orderId: result.order.id, err },
          'storefront checkout: PSP createPayment failed',
        );
        return c.json(
          {
            order: orderDto,
            payment: {
              provider: paymentProvider.provider,
              status: 'pending',
              checkoutUrl: null,
            },
            error: 'payment_provider_error',
            message: 'Payment could not be initiated; order is awaiting payment.',
          },
          502,
        );
      }
    }

    // ── Mock-flow (geen PSP geconfigureerd): ongewijzigd gedrag ──
    return c.json(
      {
        order: orderDto,
        payment: {
          provider: result.payment.provider,
          status: result.payment.status,
          reference: result.payment.reference,
          amount: result.payment.amount,
        },
      },
      201,
    );
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return c.json(
        {
          error: 'insufficient_stock',
          variantId: err.variantId,
          available: err.available,
          requested: err.requested,
        },
        422,
      );
    }
    throw err;
  }
}

// ─── helpers ─────────────────────────────────────────────────

class InsufficientStockError extends Error {
  constructor(
    public readonly variantId: string,
    public readonly available: number,
    public readonly requested: number,
  ) {
    super(`Insufficient stock for variant ${variantId}`);
  }
}

/**
 * Publieke webhook-URL die de PSP (Mollie) server-to-server aanroept. Moet vanaf
 * het internet bereikbaar zijn — daarom `API_PUBLIC_URL` (config) en NIET de
 * interne bind-host. Pad matcht de payments-router mount + handler-route.
 */
function buildWebhookUrl(provider: string): string {
  const base = env.API_PUBLIC_URL.replace(/\/+$/, '');
  return `${base}/api/payments/${provider}/webhook`;
}

/**
 * URL waar de koper terugkeert na de hosted checkout. Voorkeur: het eigen
 * storefront-domein van de shop; valt dat weg, dan de geconfigureerde admin-URL.
 * Mollie vereist een absolute URL.
 */
function buildRedirectUrl(c: Context, shop: Shop, orderNumber: string): string {
  // De terugkeerpagina heeft zowel het order-nummer als de shop nodig (de
  // storefront-API is shop-scoped). Mollie redirect exact naar deze URL.
  const path =
    `/checkout/return?order=${encodeURIComponent(orderNumber)}` +
    `&shop=${encodeURIComponent(shop.slug)}`;

  // 1) Voorkeur: de origin van de storefront die de checkout deed. De browser
  //    zet de Origin-header betrouwbaar → werkt overal (eigen domein, subdomein,
  //    lokaal) zonder configuratie en kan niet naar een vreemde host wijzen.
  const origin = c.req.header('origin');
  if (origin && /^https?:\/\/[^/]+$/i.test(origin)) {
    return `${origin.replace(/\/+$/, '')}${path}`;
  }

  // 2) Shop's eigen domein (headless/server-to-server zonder Origin-header).
  if (shop.domain && shop.domain.trim().length > 0) {
    return `https://${shop.domain.replace(/\/+$/, '')}${path}`;
  }

  // 3) Laatste vangnet: de geconfigureerde admin/public-URL.
  const base = env.ADMIN_PUBLIC_URL.replace(/\/+$/, '');
  return `${base}${path}`;
}

/**
 * Per-shop oplopend order_number (bv. 'CR-1001'). Delegeert aan de domein-helper
 * die het hoogste bestaande suffix +1 neemt (max+1) i.p.v. count(*) — count gaf
 * een fout/duplicaat volgnummer na een verwijderde order. Binnen de tx; de
 * UNIQUE(shop_id, order_number)-constraint blijft het vangnet bij een race.
 */
async function nextOrderNumber(tx: DbOrTx, shop: Shop): Promise<string> {
  return nextOrderNumberForShop(tx, shop.id, shop.slug);
}
