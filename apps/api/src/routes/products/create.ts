/**
 * POST /api/products — create product (incl varianten + options).
 *
 * Body: ProductCreateInput (zie shared/api/products.ts)
 * Auto:
 *   - slug genereren uit title als afwezig
 *   - slug-uniqueness via append `-2`, `-3`, ...
 *   - als geen varianten meegestuurd: 1 default-variant aanmaken (sku = slug-default)
 *
 * Audit: 'create' op product + per variant 'create'.
 *
 * 201 { product: ProductWithRelations }
 * 400 invalid_request
 */
import type { Context } from 'hono';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import {
  products,
  variants,
  productOptions,
  productOptionValues,
  inventoryItems,
  inventoryLevels,
  locations,
} from '../../db/schema/index.js';
import { ProductCreateInputSchema } from './_schemas.js';
import { slugify } from '../../domain/products/slugify.js';
import { makeUniqueSlug } from '../../domain/products/slug-unique.js';
import { writeProductAudit } from '../../domain/products/audit.js';
import {
  toProductCore,
  toVariantDto,
  toProductOptionDto,
} from './_serialize.js';

export async function createProduct(c: Context): Promise<Response> {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ProductCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

  // Slug-resolve (binnen tx voor race-safety)
  const result = await db.transaction(async (tx) => {
    const baseSlug = slugify(input.slug ?? input.title);
    const finalSlug = await makeUniqueSlug(tx, baseSlug);

    const [product] = await tx
      .insert(products)
      .values({
        slug: finalSlug,
        title: input.title,
        descriptionHtml: input.descriptionHtml ?? null,
        vendor: input.vendor ?? null,
        productType: input.productType ?? null,
        status: input.status,
        tags: input.tags,
      })
      .returning();
    if (!product) throw new Error('product insert returned no row');

    // Options
    const insertedOptions: Array<typeof productOptions.$inferSelect> = [];
    const insertedOptionValues: Array<typeof productOptionValues.$inferSelect> = [];
    for (const [idx, opt] of input.options.entries()) {
      const [optionRow] = await tx
        .insert(productOptions)
        .values({
          productId: product.id,
          name: opt.name,
          position: opt.position ?? idx,
        })
        .returning();
      if (!optionRow) throw new Error('option insert returned no row');
      insertedOptions.push(optionRow);
      for (const [vIdx, value] of opt.values.entries()) {
        const [valueRow] = await tx
          .insert(productOptionValues)
          .values({
            optionId: optionRow.id,
            value,
            position: vIdx,
          })
          .returning();
        if (!valueRow) throw new Error('option-value insert returned no row');
        insertedOptionValues.push(valueRow);
      }
    }

    // Variants — als leeg, maak 1 default
    const variantsToInsert =
      input.variants.length > 0
        ? input.variants
        : [
            {
              sku: `${finalSlug}-default`,
              price: '0.0000',
              compareAtPrice: null,
              costPrice: null,
              weightG: null,
              lengthMm: null,
              widthMm: null,
              heightMm: null,
              barcode: null,
              selectedOptions: {} as Record<string, string>,
              position: 0,
              taxable: true,
              taxClass: 'standard' as const,
            },
          ];

    const insertedVariants: Array<typeof variants.$inferSelect> = [];
    for (const [idx, v] of variantsToInsert.entries()) {
      const [variantRow] = await tx
        .insert(variants)
        .values({
          productId: product.id,
          sku: v.sku,
          price: v.price,
          compareAtPrice: v.compareAtPrice ?? null,
          costPrice: v.costPrice ?? null,
          weightG: v.weightG ?? null,
          lengthMm: v.lengthMm ?? null,
          widthMm: v.widthMm ?? null,
          heightMm: v.heightMm ?? null,
          barcode: v.barcode ?? null,
          selectedOptions: v.selectedOptions ?? {},
          position: v.position ?? idx,
          taxable: v.taxable ?? true,
          taxClass: v.taxClass ?? 'standard',
        })
        .returning();
      if (!variantRow) throw new Error('variant insert returned no row');
      insertedVariants.push(variantRow);
    }

    // Inventory — elke variant krijgt een inventory_item, anders verschijnt het
    // product niet in /api/stock en kan de voorraad nooit aangepast worden.
    // Daarnaast een begin-level (0) op de hoofd-locatie zodat de voorraad-
    // detailpagina meteen een locatie-rij toont om op te adjusten.
    const [defaultLocation] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.active, true))
      .orderBy(asc(locations.priority), asc(locations.code))
      .limit(1);

    for (const v of insertedVariants) {
      const [item] = await tx
        .insert(inventoryItems)
        .values({ variantId: v.id, sku: v.sku, tracked: true, requiresShipping: true })
        .returning();
      if (item && defaultLocation) {
        await tx.insert(inventoryLevels).values({
          itemId: item.id,
          locationId: defaultLocation.id,
          onHand: 0,
          available: 0,
          committed: 0,
          incoming: 0,
        });
      }
    }

    // Audit
    await writeProductAudit(tx, {
      action: 'create',
      entityType: 'product',
      entityId: product.id,
      actorId: user.id,
      after: {
        id: product.id,
        slug: product.slug,
        title: product.title,
        status: product.status,
      },
      ip,
    });
    for (const v of insertedVariants) {
      await writeProductAudit(tx, {
        action: 'create',
        entityType: 'variant',
        entityId: v.id,
        actorId: user.id,
        after: { id: v.id, sku: v.sku, price: v.price },
        ip,
      });
    }

    return {
      product,
      insertedVariants,
      insertedOptions,
      insertedOptionValues,
    };
  });

  return c.json(
    {
      product: {
        ...toProductCore(result.product),
        variants: result.insertedVariants.map(toVariantDto),
        options: result.insertedOptions.map((o) =>
          toProductOptionDto(o, result.insertedOptionValues),
        ),
        images: [], // geen images bij create — image-agent levert upload later
      },
    },
    201,
  );
}
