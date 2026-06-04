/**
 * Centrale mutable mock-state laag.
 *
 * - Wraps de read-only mock-data uit `mock-data-extended.ts` in mutable arrays.
 * - Exposeert hooks per dataset met handige mutation-functions.
 * - Persists naar `localStorage` met key `webshop-crm:mock-state:v1`
 *   (zo blijven recente mutaties ook na refresh staan tot de gebruiker
 *   `resetMockState()` aanroept of localStorage wist).
 *
 * Patroon: 1 module-store + `useSyncExternalStore` voor componenten.
 */
import { useSyncExternalStore } from 'react';
import {
  MOCK_ORDERS, MOCK_CUSTOMERS, MOCK_RETURNS, MOCK_LOCATIONS_FULL,
  MOCK_PURCHASE_ORDERS, MOCK_SUPPLIERS, MOCK_CHANNELS,
  MOCK_PRODUCT_CHANNEL_MATRIX, MOCK_ADMIN_USERS, MOCK_API_TOKENS, MOCK_WEBHOOKS,
  MOCK_ACCOUNTING_CONNECTIONS,
  type MockOrder, type OrderStatus, type PaymentStatus,
  type MockCustomer,
  type MockReturn, type ReturnStatus,
  type MockLocationFull,
  type MockPurchaseOrder, type PoStatus,
  type MockSupplier,
  type MockChannel, type ChannelSlug,
  type ProductChannelMatrixRow,
  type MockAdminUser,
  type MockApiToken,
  type MockWebhook,
  type AccountingConnection,
} from './mock-data-extended';

const STORAGE_KEY = 'webshop-crm:mock-state:v1';

/* ─── Custom channel-types (additions to ChannelSlug) ─────────────── */
/** Extra dynamic-channel slugs (channels added via UI) — values flow through everywhere as untyped strings. */
export type AnyChannelSlug = ChannelSlug | string;

interface PersistedState {
  orders?: MockOrder[];
  customers?: MockCustomer[];
  returns?: MockReturn[];
  locations?: MockLocationFull[];
  purchaseOrders?: MockPurchaseOrder[];
  suppliers?: MockSupplier[];
  channels?: MockChannel[];
  matrix?: ProductChannelMatrixRow[];
  poLines?: Record<string, PoLine[]>;
  users?: MockAdminUser[];
  tokens?: MockApiToken[];
  webhooks?: MockWebhook[];
  accountingConnections?: AccountingConnection[];
  channelConfigs?: Record<string, Record<string, unknown>>;
}

/** Synthetische line-items per PO (mock-data heeft alleen aggregates). */
export interface PoLine {
  id: string;
  sku: string;
  title: string;
  orderedQty: number;
  receivedQty: number;
  unitPrice: number;
}

interface State {
  orders: MockOrder[];
  customers: MockCustomer[];
  returns: MockReturn[];
  locations: MockLocationFull[];
  purchaseOrders: MockPurchaseOrder[];
  poLines: Record<string, PoLine[]>;
  suppliers: MockSupplier[];
  channels: MockChannel[];
  matrix: ProductChannelMatrixRow[];
  users: MockAdminUser[];
  tokens: MockApiToken[];
  webhooks: MockWebhook[];
  accountingConnections: AccountingConnection[];
  /** Per-channel configuratie (form-state uit Configureren-drawer). */
  channelConfigs: Record<string, Record<string, unknown>>;
}

/** Genereer line-items voor een PO op basis van zijn aggregates. */
function buildPoLines(po: MockPurchaseOrder): PoLine[] {
  const lines: PoLine[] = [];
  const itemTotal = po.itemsCount;
  const totalOrdered = po.orderedQty;
  const totalReceived = po.receivedQty;
  const totalExcl = po.totalExclVat;
  const baseQty = Math.floor(totalOrdered / itemTotal);
  const extra = totalOrdered - baseQty * itemTotal;
  let leftReceived = totalReceived;
  for (let i = 0; i < itemTotal; i++) {
    const ordered = baseQty + (i < extra ? 1 : 0);
    const received = Math.min(ordered, Math.max(0, leftReceived));
    leftReceived -= received;
    lines.push({
      id: `${po.id}-line-${i + 1}`,
      sku: `SUP-${po.supplierId.slice(0, 4).toUpperCase()}-${String(i + 1).padStart(2, '0')}`,
      title: `Inkoopregel ${i + 1}`,
      orderedQty: ordered,
      receivedQty: received,
      unitPrice: ordered > 0 ? Math.round((totalExcl / totalOrdered) * 100) / 100 : 0,
    });
  }
  return lines;
}

/* ─── Persistence ─── */

function loadPersisted(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function savePersisted(state: State) {
  if (typeof window === 'undefined') return;
  try {
    const toSave: PersistedState = {
      orders: state.orders,
      customers: state.customers,
      returns: state.returns,
      locations: state.locations,
      purchaseOrders: state.purchaseOrders,
      poLines: state.poLines,
      suppliers: state.suppliers,
      channels: state.channels,
      matrix: state.matrix,
      users: state.users,
      tokens: state.tokens,
      webhooks: state.webhooks,
      accountingConnections: state.accountingConnections,
      channelConfigs: state.channelConfigs,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // ignore quota errors
  }
}

/* ─── Initial state ─── */

const persisted = loadPersisted();

const state: State = {
  orders: persisted?.orders ?? MOCK_ORDERS.map((o) => ({ ...o })),
  customers: persisted?.customers ?? MOCK_CUSTOMERS.map((c) => ({ ...c })),
  returns: persisted?.returns ?? MOCK_RETURNS.map((r) => ({ ...r })),
  locations: persisted?.locations ?? MOCK_LOCATIONS_FULL.map((l) => ({ ...l })),
  purchaseOrders: persisted?.purchaseOrders ?? MOCK_PURCHASE_ORDERS.map((p) => ({ ...p })),
  poLines: persisted?.poLines ?? Object.fromEntries(MOCK_PURCHASE_ORDERS.map((p) => [p.id, buildPoLines(p)])),
  suppliers: persisted?.suppliers ?? MOCK_SUPPLIERS.map((s) => ({ ...s })),
  channels: persisted?.channels ?? MOCK_CHANNELS.map((c) => ({ ...c })),
  matrix: persisted?.matrix ?? MOCK_PRODUCT_CHANNEL_MATRIX.map((row) => ({
    ...row,
    channels: { ...row.channels },
  })),
  users: persisted?.users ?? MOCK_ADMIN_USERS.map((u) => ({ ...u })),
  tokens: persisted?.tokens ?? MOCK_API_TOKENS.map((t) => ({ ...t })),
  webhooks: persisted?.webhooks ?? MOCK_WEBHOOKS.map((w) => ({ ...w, events: [...w.events] })),
  accountingConnections: persisted?.accountingConnections ?? MOCK_ACCOUNTING_CONNECTIONS.map((c) => ({ ...c })),
  channelConfigs: persisted?.channelConfigs ?? {},
};

/* ─── Pub/Sub ─── */

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  savePersisted(state);
  listeners.forEach((fn) => fn());
}

function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ─── Order mutations ─── */

export interface OrderUpdates {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  trackingNumber?: string;
  shippedAt?: string;
}

export const orderActions = {
  list(): MockOrder[] {
    return state.orders;
  },
  get(idOrNumber: string): MockOrder | undefined {
    return state.orders.find((o) => o.id === idOrNumber || o.number === idOrNumber);
  },
  update(idOrNumber: string, patch: OrderUpdates) {
    state.orders = state.orders.map((o) =>
      (o.id === idOrNumber || o.number === idOrNumber) ? { ...o, ...patch } : o,
    );
    notify();
  },
  cancel(idOrNumber: string) {
    orderActions.update(idOrNumber, { status: 'cancelled' });
  },
  setStatus(idOrNumber: string, status: OrderStatus) {
    orderActions.update(idOrNumber, { status });
  },
  generateTrackingNumber(idOrNumber: string, carrier: string): string {
    const tn = `${carrier.slice(0, 2).toUpperCase()}${Math.floor(Math.random() * 9_000_000_000 + 1_000_000_000)}NL`;
    orderActions.update(idOrNumber, {
      trackingNumber: tn,
      status: 'shipped',
      shippedAt: new Date().toISOString(),
    });
    return tn;
  },
  add(order: MockOrder) {
    state.orders = [order, ...state.orders];
    notify();
  },
  remove(idOrNumber: string): MockOrder | undefined {
    const removed = state.orders.find((o) => o.id === idOrNumber || o.number === idOrNumber);
    state.orders = state.orders.filter((o) => o.id !== idOrNumber && o.number !== idOrNumber);
    notify();
    return removed;
  },
  restore(o: MockOrder) {
    if (!state.orders.some((x) => x.id === o.id)) {
      state.orders = [o, ...state.orders];
      notify();
    }
  },
  bulkSetStatus(idsOrNumbers: string[], status: OrderStatus) {
    const set = new Set(idsOrNumbers);
    state.orders = state.orders.map((o) => (set.has(o.id) || set.has(o.number) ? { ...o, status } : o));
    notify();
  },
};

/* ─── Customer mutations ─── */

export const customerActions = {
  list(): MockCustomer[] {
    return state.customers;
  },
  get(id: string): MockCustomer | undefined {
    return state.customers.find((c) => c.id === id);
  },
  add(c: MockCustomer) {
    state.customers = [c, ...state.customers];
    notify();
  },
  update(id: string, patch: Partial<MockCustomer>) {
    state.customers = state.customers.map((c) => (c.id === id ? { ...c, ...patch } : c));
    notify();
  },
  remove(id: string): MockCustomer | undefined {
    const removed = state.customers.find((c) => c.id === id);
    state.customers = state.customers.filter((c) => c.id !== id);
    notify();
    return removed;
  },
  /** Re-insert a previously removed customer. */
  restore(c: MockCustomer) {
    if (!state.customers.some((x) => x.id === c.id)) {
      state.customers = [c, ...state.customers];
      notify();
    }
  },
  bulkUpdate(ids: string[], patch: Partial<MockCustomer>) {
    const set = new Set(ids);
    state.customers = state.customers.map((c) => (set.has(c.id) ? { ...c, ...patch } : c));
    notify();
  },
};

/* ─── Return mutations ─── */

export const returnActions = {
  list(): MockReturn[] {
    return state.returns;
  },
  get(id: string): MockReturn | undefined {
    return state.returns.find((r) => r.id === id || r.rmaNumber === id);
  },
  setStatus(id: string, status: ReturnStatus) {
    state.returns = state.returns.map((r) => (r.id === id ? { ...r, status, closedAt: ['refunded', 'rejected'].includes(status) ? new Date().toISOString() : r.closedAt } : r));
    notify();
  },
  setRefundAmount(id: string, amount: number) {
    state.returns = state.returns.map((r) => (r.id === id ? { ...r, refundAmount: amount } : r));
    notify();
  },
  add(r: MockReturn) {
    state.returns = [r, ...state.returns];
    notify();
  },
  update(id: string, patch: Partial<MockReturn>) {
    state.returns = state.returns.map((r) => (r.id === id ? { ...r, ...patch } : r));
    notify();
  },
  remove(id: string): MockReturn | undefined {
    const removed = state.returns.find((r) => r.id === id);
    state.returns = state.returns.filter((r) => r.id !== id);
    notify();
    return removed;
  },
  restore(r: MockReturn) {
    if (!state.returns.some((x) => x.id === r.id)) {
      state.returns = [r, ...state.returns];
      notify();
    }
  },
};

/* ─── Location mutations ─── */

export const locationActions = {
  list(): MockLocationFull[] {
    return state.locations;
  },
  add(loc: MockLocationFull) {
    state.locations = [...state.locations, loc];
    notify();
  },
  update(id: string, patch: Partial<MockLocationFull>) {
    state.locations = state.locations.map((l) => (l.id === id ? { ...l, ...patch } : l));
    notify();
  },
  toggleActive(id: string) {
    state.locations = state.locations.map((l) => (l.id === id ? { ...l, active: !l.active } : l));
    notify();
  },
  remove(id: string): MockLocationFull | undefined {
    const removed = state.locations.find((l) => l.id === id);
    if (removed && removed.totalQty > 0) return undefined;
    state.locations = state.locations.filter((l) => l.id !== id);
    notify();
    return removed;
  },
  restore(l: MockLocationFull) {
    if (!state.locations.some((x) => x.id === l.id)) {
      state.locations = [...state.locations, l];
      notify();
    }
  },
  reorder(idA: string, idB: string) {
    const a = state.locations.find((l) => l.id === idA);
    const b = state.locations.find((l) => l.id === idB);
    if (!a || !b) return;
    const pa = a.priority;
    state.locations = state.locations.map((l) => {
      if (l.id === idA) return { ...l, priority: b.priority };
      if (l.id === idB) return { ...l, priority: pa };
      return l;
    });
    notify();
  },
};

/* ─── Purchase Order mutations ─── */

export const poActions = {
  list(): MockPurchaseOrder[] {
    return state.purchaseOrders;
  },
  get(idOrNumber: string): MockPurchaseOrder | undefined {
    return state.purchaseOrders.find((p) => p.id === idOrNumber || p.number === idOrNumber);
  },
  lines(poId: string): PoLine[] {
    return state.poLines[poId] ?? [];
  },
  setStatus(idOrNumber: string, status: PoStatus) {
    state.purchaseOrders = state.purchaseOrders.map((p) =>
      (p.id === idOrNumber || p.number === idOrNumber) ? { ...p, status } : p,
    );
    notify();
  },
  receiveLine(poId: string, lineId: string, qty: number) {
    const po = state.purchaseOrders.find((p) => p.id === poId || p.number === poId);
    if (!po) return;
    const lines = (state.poLines[po.id] ?? []).map((l) =>
      l.id === lineId ? { ...l, receivedQty: Math.max(0, Math.min(l.orderedQty, l.receivedQty + qty)) } : l,
    );
    state.poLines = { ...state.poLines, [po.id]: lines };
    const totalOrdered = lines.reduce((s, l) => s + l.orderedQty, 0);
    const totalReceived = lines.reduce((s, l) => s + l.receivedQty, 0);
    let status: PoStatus = po.status;
    if (totalReceived === 0) status = po.status === 'partial' ? 'sent' : po.status;
    else if (totalReceived >= totalOrdered) status = 'received';
    else status = 'partial';
    state.purchaseOrders = state.purchaseOrders.map((p) =>
      p.id === po.id ? { ...p, receivedQty: totalReceived, orderedQty: totalOrdered, status } : p,
    );
    notify();
  },
  add(po: MockPurchaseOrder, lines: PoLine[]) {
    state.purchaseOrders = [po, ...state.purchaseOrders];
    state.poLines = { ...state.poLines, [po.id]: lines };
    notify();
  },
};

/* ─── Supplier mutations ─── */

export const supplierActions = {
  list(): MockSupplier[] {
    return state.suppliers;
  },
  get(id: string): MockSupplier | undefined {
    return state.suppliers.find((s) => s.id === id);
  },
  add(s: MockSupplier) {
    state.suppliers = [...state.suppliers, s];
    notify();
  },
  update(id: string, patch: Partial<MockSupplier>) {
    state.suppliers = state.suppliers.map((s) => (s.id === id ? { ...s, ...patch } : s));
    notify();
  },
  toggleActive(id: string) {
    state.suppliers = state.suppliers.map((s) => (s.id === id ? { ...s, active: !s.active } : s));
    notify();
  },
  /** Remove only if no open PO's exist; returns undefined if blocked. */
  remove(id: string): { removed?: MockSupplier; blocked?: boolean } {
    const sup = state.suppliers.find((s) => s.id === id);
    if (!sup) return { blocked: false };
    const hasOpenPos = state.purchaseOrders.some((p) => p.supplierId === id && !['received', 'closed', 'cancelled'].includes(p.status));
    if (hasOpenPos) return { blocked: true };
    state.suppliers = state.suppliers.filter((s) => s.id !== id);
    notify();
    return { removed: sup };
  },
  restore(s: MockSupplier) {
    if (!state.suppliers.some((x) => x.id === s.id)) {
      state.suppliers = [...state.suppliers, s];
      notify();
    }
  },
};

/* ─── Channel mutations ─── */

export const channelActions = {
  list(): MockChannel[] {
    return state.channels;
  },
  toggleActive(slug: AnyChannelSlug) {
    state.channels = state.channels.map((c) =>
      c.slug === slug
        ? { ...c, status: c.status === 'paused' ? 'connected' : 'paused' }
        : c,
    );
    notify();
  },
  setLastSync(slug: AnyChannelSlug) {
    state.channels = state.channels.map((c) => (c.slug === slug ? { ...c, lastSync: new Date().toISOString() } : c));
    notify();
  },
  saveConfig(slug: AnyChannelSlug, cfg: Record<string, unknown>) {
    state.channelConfigs = { ...state.channelConfigs, [slug]: cfg };
    notify();
  },
  getConfig(slug: AnyChannelSlug): Record<string, unknown> | undefined {
    return state.channelConfigs[slug];
  },
  add(c: MockChannel) {
    state.channels = [...state.channels, c];
    notify();
  },
  remove(slug: AnyChannelSlug): MockChannel | undefined {
    const removed = state.channels.find((c) => c.slug === slug);
    state.channels = state.channels.filter((c) => c.slug !== slug);
    notify();
    return removed;
  },
};

/* ─── Matrix mutations ─── */

export const matrixActions = {
  list(): ProductChannelMatrixRow[] {
    return state.matrix;
  },
  toggleCell(productId: string, channelSlug: ChannelSlug) {
    state.matrix = state.matrix.map((row) => {
      if (row.productId !== productId) return row;
      const cell = row.channels[channelSlug];
      if (!cell) return row;
      return {
        ...row,
        channels: {
          ...row.channels,
          [channelSlug]: { ...cell, enabled: !cell.enabled, status: cell.enabled ? 'disabled' : 'live' },
        },
      };
    });
    notify();
  },
  bulkSetForChannel(channelSlug: ChannelSlug, enabled: boolean) {
    state.matrix = state.matrix.map((row) => {
      const cell = row.channels[channelSlug];
      if (!cell) return row;
      return {
        ...row,
        channels: {
          ...row.channels,
          [channelSlug]: { ...cell, enabled, status: enabled ? 'live' : 'disabled' },
        },
      };
    });
    notify();
  },
};

/* ─── Settings mutations ─── */

export const userActions = {
  list(): MockAdminUser[] {
    return state.users;
  },
  add(u: MockAdminUser) {
    state.users = [...state.users, u];
    notify();
  },
  update(id: string, patch: Partial<MockAdminUser>) {
    state.users = state.users.map((u) => (u.id === id ? { ...u, ...patch } : u));
    notify();
  },
  remove(id: string) {
    state.users = state.users.filter((u) => u.id !== id);
    notify();
  },
};

export const tokenActions = {
  list(): MockApiToken[] {
    return state.tokens;
  },
  add(t: MockApiToken) {
    state.tokens = [t, ...state.tokens];
    notify();
  },
  revoke(id: string) {
    state.tokens = state.tokens.map((t) => (t.id === id ? { ...t, active: false } : t));
    notify();
  },
};

export const webhookActions = {
  list(): MockWebhook[] {
    return state.webhooks;
  },
  add(w: MockWebhook) {
    state.webhooks = [...state.webhooks, w];
    notify();
  },
  update(id: string, patch: Partial<MockWebhook>) {
    state.webhooks = state.webhooks.map((w) => (w.id === id ? { ...w, ...patch } : w));
    notify();
  },
  remove(id: string) {
    state.webhooks = state.webhooks.filter((w) => w.id !== id);
    notify();
  },
};

export const accountingActions = {
  list(): AccountingConnection[] {
    return state.accountingConnections;
  },
  connect(id: string) {
    state.accountingConnections = state.accountingConnections.map((c) =>
      c.id === id ? { ...c, status: c.status === 'sandbox' ? 'connected' : 'connected', lastSync: new Date().toISOString() } : c,
    );
    notify();
  },
};

/* ─── Hooks (useSyncExternalStore) ─── */

export function useOrders(): MockOrder[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.orders,
    () => state.orders,
  );
}

export function useCustomers(): MockCustomer[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.customers,
    () => state.customers,
  );
}

export function useReturns(): MockReturn[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.returns,
    () => state.returns,
  );
}

export function useLocations(): MockLocationFull[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.locations,
    () => state.locations,
  );
}

export function usePurchaseOrders(): MockPurchaseOrder[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.purchaseOrders,
    () => state.purchaseOrders,
  );
}

const EMPTY_LINES: PoLine[] = [];
export function usePoLines(poId: string | undefined): PoLine[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => (poId ? state.poLines[poId] ?? EMPTY_LINES : EMPTY_LINES),
    () => (poId ? state.poLines[poId] ?? EMPTY_LINES : EMPTY_LINES),
  );
}

export function useSuppliers(): MockSupplier[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.suppliers,
    () => state.suppliers,
  );
}

export function useChannels(): MockChannel[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.channels,
    () => state.channels,
  );
}

export function useMatrix(): ProductChannelMatrixRow[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.matrix,
    () => state.matrix,
  );
}

export function useUsers(): MockAdminUser[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.users,
    () => state.users,
  );
}

export function useTokens(): MockApiToken[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.tokens,
    () => state.tokens,
  );
}

export function useWebhooks(): MockWebhook[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.webhooks,
    () => state.webhooks,
  );
}

export function useAccountingConnections(): AccountingConnection[] {
  return useSyncExternalStore(
    (cb) => { const u = subscribe(cb); return () => { u(); }; },
    () => state.accountingConnections,
    () => state.accountingConnections,
  );
}

/* ─── Utils ─── */

export function resetMockState() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }
}
