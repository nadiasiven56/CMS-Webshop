/**
 * Channel-sync E2E — ECHTE Postgres (:7432) + GEMOCKTE adapter.
 *
 * We mocken alleen de adapter-registry (`./adapters/index.js`) zodat we de
 * fetchOrders-output controleren zonder een echte marketplace te raken; de
 * upsert op channel_orders draait tegen de echte DB. De fake-adapter is bewust
 * GEEN OwnWebshopAdapter, zodat de listings-tak wordt overgeslagen en we puur de
 * order-import + idempotente upsert testen.
 *
 * Dekt:
 *   - fetchOrders levert 2 orders → ordersImported=2, 2 channel_orders-rijen.
 *   - 2e sync met dezelfde 2 orders → GEEN duplicaten (UNIQUE channel_id +
 *     external_order_id), nog steeds 2 rijen; een bestaande order_id-koppeling
 *     blijft behouden (coalesce in de upsert).
 *   - een adapter die channel_not_connected gooit → reason:'not_connected'
 *     (geen throw naar de caller).
 *
 * Uniek per run + cleanup in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../../../lib/db.js';
import { channels } from '../../../db/schema/channels.js';
import { channelOrders } from '../../../db/schema/channel-orders.js';
import { shops } from '../../../db/schema/shops.js';
import { orders } from '../../../db/schema/orders.js';
import { ChannelNotConnectedError, type NormalizedOrder } from '../adapters/types.js';

// ─── Mock de adapter-registry ───────────────────────────────────
//   getAdapter geeft een fake terug. De fake-state is per test instelbaar via de
//   gedeelde `adapterState`. De fake is NIET instanceof OwnWebshopAdapter → de
//   listings-tak van runChannelSync wordt overgeslagen.
const adapterState: {
  orders: NormalizedOrder[];
  throwNotConnected: boolean;
} = { orders: [], throwNotConnected: false };

vi.mock('../adapters/index.js', () => {
  const fakeAdapter = {
    type: 'bol',
    async fetchOrders(): Promise<NormalizedOrder[]> {
      if (adapterState.throwNotConnected) {
        throw new ChannelNotConnectedError('Bol credentials required');
      }
      return adapterState.orders;
    },
    async verifyConnection() {
      return { ok: true, detail: 'mock' };
    },
    async acknowledgeOrder() {},
    async submitShipment() {},
    async pushListing() {
      return { externalId: 'x' };
    },
    async updateInventory() {},
    normalizeOrder(raw: Record<string, unknown>) {
      return raw as unknown as NormalizedOrder;
    },
  };
  return {
    getAdapter: () => fakeAdapter,
    SUPPORTED_CHANNEL_TYPES: ['bol'],
  };
});

const { runChannelSync } = await import('../sync.js');

const RUN = Date.now().toString(36);
let channelId: string;
let shopId: string;
let crmOrderId: string;

function order(externalId: string, crmOrderId: string | null = null): NormalizedOrder {
  return {
    externalId,
    channelType: 'bol',
    email: null,
    currency: 'EUR',
    placedAt: null,
    items: [],
    raw: { externalId, tag: RUN },
    crmOrderId,
  };
}

beforeAll(async () => {
  const [ch] = await db
    .insert(channels)
    .values({ type: 'bol', name: `Sync Test ${RUN}`, status: 'connected' })
    .returning();
  channelId = ch!.id;

  // Een echte shop + order zodat de coalesce-test een geldig FK-order_id heeft
  // (channel_orders.order_id heeft een FK op orders.id).
  const [shop] = await db
    .insert(shops)
    .values({ slug: `sync-shop-${RUN}`, name: 'Sync Shop', status: 'active' })
    .returning();
  shopId = shop!.id;
  const [ord] = await db
    .insert(orders)
    .values({ shopId, orderNumber: `SY-${RUN}`, grandTotal: '10.0000' })
    .returning();
  crmOrderId = ord!.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  try {
    if (channelId) {
      await db.delete(channelOrders).where(eq(channelOrders.channelId, channelId));
      await db.delete(channels).where(eq(channels.id, channelId));
    }
    if (shopId) {
      await db.delete(orders).where(eq(orders.shopId, shopId));
      await db.delete(shops).where(eq(shops.id, shopId));
    }
  } finally {
    await closeDb();
  }
});

describe('runChannelSync — order-import + idempotentie', () => {
  it('importeert 2 orders en schrijft 2 channel_orders-rijen', async () => {
    adapterState.throwNotConnected = false;
    adapterState.orders = [order(`EXT-A-${RUN}`), order(`EXT-B-${RUN}`)];

    const result = await runChannelSync(channelId, { type: 'job', id: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ordersImported).toBe(2);
      expect(result.errors).toEqual([]);
    }

    const rows = await db
      .select()
      .from(channelOrders)
      .where(eq(channelOrders.channelId, channelId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.externalOrderId).sort()).toEqual(
      [`EXT-A-${RUN}`, `EXT-B-${RUN}`].sort(),
    );
  });

  it('2e sync met dezelfde orders maakt GEEN duplicaten (UNIQUE channel_id+external)', async () => {
    adapterState.orders = [order(`EXT-A-${RUN}`), order(`EXT-B-${RUN}`)];

    const result = await runChannelSync(channelId, { type: 'job', id: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ordersImported).toBe(2);

    const rows = await db
      .select()
      .from(channelOrders)
      .where(eq(channelOrders.channelId, channelId));
    // Nog steeds 2 rijen — upsert i.p.v. insert-duplicaat.
    expect(rows).toHaveLength(2);
  });

  it('een bestaande order_id-koppeling blijft behouden bij een re-sync met null (coalesce)', async () => {
    const externalId = `EXT-LINK-${RUN}`;

    // 1) sync met een gekoppeld order_id.
    adapterState.orders = [order(externalId, crmOrderId)];
    await runChannelSync(channelId, { type: 'job', id: null });

    const linked = (
      await db.select().from(channelOrders).where(eq(channelOrders.channelId, channelId))
    ).find((r) => r.externalOrderId === externalId);
    expect(linked?.orderId).toBe(crmOrderId);

    // 2) re-sync met order_id=null → koppeling moet behouden blijven (coalesce).
    adapterState.orders = [order(externalId, null)];
    await runChannelSync(channelId, { type: 'job', id: null });

    const after = (
      await db.select().from(channelOrders).where(eq(channelOrders.channelId, channelId))
    ).find((r) => r.externalOrderId === externalId);
    expect(after?.orderId).toBe(crmOrderId); // niet overschreven met null
  });
});

describe('runChannelSync — not_connected', () => {
  it('een adapter die channel_not_connected gooit geeft reason:not_connected (geen throw)', async () => {
    adapterState.throwNotConnected = true;
    adapterState.orders = [];

    const result = await runChannelSync(channelId, { type: 'job', id: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_connected');
    }
    adapterState.throwNotConnected = false;
  });
});
