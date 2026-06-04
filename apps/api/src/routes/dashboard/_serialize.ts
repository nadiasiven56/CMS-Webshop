/**
 * DashboardKpis-DTO + pure builder voor de dashboard-module.
 *
 * De shape `DashboardKpis` MOET exact gelijk zijn aan
 * `apps/admin/src/lib/mock-data.ts` -> `DashboardKpis`, zodat de admin de
 * echte `/api/dashboard/kpis`-response 1-op-1 consumeert zonder code-wijziging.
 *
 * `buildKpis(...)` is een PURE functie (geen DB, geen Date.now-afhankelijkheid
 * behalve via meegegeven `now`) zodat hij in isolatie te unit-testen is. De
 * route-handler doet de Postgres-aggregaties en geeft de cijfers hier door.
 *
 * Geld komt binnen als hele CENTEN (integers) — geen float-drift — en wordt
 * voor de KPI-shape naar `number` (euro's, 2 decimalen) afgerond, omdat de
 * admin-DTO numbers verwacht (geen Money-strings) voor charts/sparklines.
 */

/* ─── DTO — EXACT de admin-shape ─────────────────────────────────────── */

export interface DashboardKpis {
  revenue30d: number;
  revenue30dDelta: number; // pct vs vorige periode
  revenueSeries: Array<{ day: string; revenue: number }>;
  openOrders: number;
  openOrdersUnpaid: number;
  openOrdersToShip: number;
  lowStockCount: number;
  lowStockTop: Array<{ sku: string; available: number; productTitle: string }>;
  topProducts: Array<{ title: string; revenue: number }>;
  channels: Array<{ name: string; status: 'connected' | 'warning' | 'error'; lastSync: string }>;
  recentActivity: Array<{
    id: string;
    type: 'order' | 'stock' | 'login' | 'product';
    actor: string;
    text: string;
    timestamp: string;
  }>;
}

/* ─── Input-vorm vanuit de route-aggregaties ─────────────────────────── */

export interface KpiAggregates {
  /** Som omzet (net) per dag, hele centen, key = 'YYYY-MM-DD'. */
  revenueByDayCents: Map<string, number>;
  /** Som omzet (net) in centen over de vorige periode (voor delta). */
  prevRevenueCents: number;
  /** De 30 dag-labels (oudste→nieuwste) waarover de serie loopt. */
  days: string[];
  openOrders: number;
  openOrdersUnpaid: number;
  openOrdersToShip: number;
  lowStockCount: number;
  lowStockTop: Array<{ sku: string; available: number; productTitle: string }>;
  /** Top-producten op omzet, centen. */
  topProductsCents: Array<{ title: string; revenueCents: number }>;
  /** Channels uit de echte channels-tabel. */
  channels: Array<{ name: string; status: string; lastSyncAt: Date | null }>;
  /** Recente audit-rows (al gemapt naar activity-shape). */
  recentActivity: DashboardKpis['recentActivity'];
}

/* ─── Helpers ────────────────────────────────────────────────────────── */

/** Hele centen → euro's als number (2 decimalen). */
export function centsToNumber(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Map de channels.status-enum ('connected'|'disconnected'|'error'|...) naar de
 * admin-KPI-status ('connected'|'warning'|'error'). Onbekend/disconnected →
 * 'warning' zodat de UI een neutrale waarschuwing toont i.p.v. een harde fout.
 */
export function mapChannelStatus(status: string): 'connected' | 'warning' | 'error' {
  if (status === 'connected') return 'connected';
  if (status === 'error') return 'error';
  return 'warning';
}

/** lastSyncAt → mensvriendelijke "x min/uur/dag geleden" (nl). */
export function relativeTime(from: Date | null, now: Date): string {
  if (!from) return 'nooit';
  const sec = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (sec < 60) return 'zojuist';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min geleden`;
  const uur = Math.floor(min / 60);
  if (uur < 24) return `${uur} uur geleden`;
  const dag = Math.floor(uur / 24);
  return `${dag} ${dag === 1 ? 'dag' : 'dagen'} geleden`;
}

/* ─── Pure builder ───────────────────────────────────────────────────── */

export function buildKpis(agg: KpiAggregates, now: Date = new Date()): DashboardKpis {
  const revenueSeries = agg.days.map((day) => ({
    day,
    revenue: centsToNumber(agg.revenueByDayCents.get(day) ?? 0),
  }));
  const revenue30dCents = [...agg.revenueByDayCents.values()].reduce((s, v) => s + v, 0);
  const revenue30d = centsToNumber(revenue30dCents);

  // delta = pct-verschil t.o.v. de vorige periode. 0/0 → 0; iets/0 → 100.
  let revenue30dDelta = 0;
  if (agg.prevRevenueCents > 0) {
    revenue30dDelta =
      Math.round(((revenue30dCents - agg.prevRevenueCents) / agg.prevRevenueCents) * 1000) / 10;
  } else if (revenue30dCents > 0) {
    revenue30dDelta = 100;
  }

  return {
    revenue30d,
    revenue30dDelta,
    revenueSeries,
    openOrders: agg.openOrders,
    openOrdersUnpaid: agg.openOrdersUnpaid,
    openOrdersToShip: agg.openOrdersToShip,
    lowStockCount: agg.lowStockCount,
    lowStockTop: agg.lowStockTop.map((r) => ({
      sku: r.sku,
      available: r.available,
      productTitle: r.productTitle,
    })),
    topProducts: agg.topProductsCents.map((p) => ({
      title: p.title,
      revenue: centsToNumber(p.revenueCents),
    })),
    channels: agg.channels.map((ch) => ({
      name: ch.name,
      status: mapChannelStatus(ch.status),
      lastSync: relativeTime(ch.lastSyncAt, now),
    })),
    recentActivity: agg.recentActivity,
  };
}

/**
 * Map een audit_log-row naar een KPI recentActivity-item. `entityType` →
 * activity-`type` (fallback 'product'). De `text` is een korte NL-samenvatting.
 */
export function auditRowToActivity(row: {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  ts: Date;
}): DashboardKpis['recentActivity'][number] {
  const type = ((): DashboardKpis['recentActivity'][number]['type'] => {
    switch (row.entityType) {
      case 'order':
        return 'order';
      case 'inventory_movement':
      case 'inventory_level':
        return 'stock';
      case 'session':
      case 'login':
        return 'login';
      default:
        return 'product';
    }
  })();

  const actor = row.actorType === 'user' ? (row.actorId ?? 'systeem') : row.actorType;
  const text = `${row.action} ${row.entityType.replace(/_/g, ' ')}`;

  return {
    id: row.id,
    type,
    actor,
    text,
    timestamp: row.ts.toISOString(),
  };
}
