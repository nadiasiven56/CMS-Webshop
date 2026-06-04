/**
 * Mini herbruikbare pills voor orders. Pure presentational, geen state.
 *
 * Werkt tegen de ECHTE backend-statuswaarden (zie
 * apps/api/src/domain/orders/status-machine.ts + orders-schema):
 *   - order.status         : pending | paid | fulfilled | shipped | delivered | cancelled | refunded
 *   - financial_status     : pending | paid | partially_refunded | refunded
 *   - fulfillment_status   : unfulfilled | fulfilled | shipped | delivered | pending
 *   - channel              : web | bol | amazon | gmc
 *   - return.status        : requested | approved | received | refunded | rejected
 *
 * Onbekende waarden krijgen een neutrale pill met de ruwe string.
 */

const ORDER_STATUS_MAP: Record<string, { label: string; klass: string }> = {
  pending: { label: 'Open', klass: 'badge-warning' },
  paid: { label: 'Betaald', klass: 'badge-info' },
  fulfilled: { label: 'Verwerkt', klass: 'badge-accent' },
  shipped: { label: 'Verzonden', klass: 'badge-accent' },
  delivered: { label: 'Bezorgd', klass: 'badge-success' },
  cancelled: { label: 'Geannuleerd', klass: 'badge-danger' },
  refunded: { label: 'Terugbetaald', klass: 'badge-neutral' },
};

const FINANCIAL_STATUS_MAP: Record<string, { label: string; klass: string }> = {
  pending: { label: 'Open', klass: 'badge-warning' },
  paid: { label: 'Betaald', klass: 'badge-success' },
  partially_refunded: { label: 'Deels terugbet.', klass: 'badge-neutral' },
  refunded: { label: 'Terugbetaald', klass: 'badge-neutral' },
};

const FULFILLMENT_STATUS_MAP: Record<string, { label: string; klass: string }> = {
  unfulfilled: { label: 'Niet verwerkt', klass: 'badge-neutral' },
  pending: { label: 'In behandeling', klass: 'badge-warning' },
  fulfilled: { label: 'Verwerkt', klass: 'badge-info' },
  shipped: { label: 'Verzonden', klass: 'badge-accent' },
  delivered: { label: 'Bezorgd', klass: 'badge-success' },
};

const RETURN_STATUS_MAP: Record<string, { label: string; klass: string }> = {
  requested: { label: 'Aangevraagd', klass: 'badge-warning' },
  approved: { label: 'Goedgekeurd', klass: 'badge-info' },
  received: { label: 'Ontvangen', klass: 'badge-accent' },
  refunded: { label: 'Terugbetaald', klass: 'badge-success' },
  rejected: { label: 'Afgewezen', klass: 'badge-danger' },
};

const PAYMENT_STATUS_MAP: Record<string, { label: string; klass: string }> = {
  paid: { label: 'Betaald', klass: 'badge-success' },
  pending: { label: 'Open', klass: 'badge-warning' },
  failed: { label: 'Mislukt', klass: 'badge-danger' },
  refunded: { label: 'Terugbetaald', klass: 'badge-neutral' },
};

const CHANNEL_MAP: Record<string, { label: string; letter: string; color: string }> = {
  web: { label: 'Webshop', letter: 'W', color: '#ff9f43' },
  bol: { label: 'Bol.com', letter: 'B', color: '#0000a4' },
  amazon: { label: 'Amazon', letter: 'A', color: '#ff9900' },
  gmc: { label: 'Google', letter: 'G', color: '#4285f4' },
};

function Pill({ map, value }: { map: Record<string, { label: string; klass: string }>; value: string }) {
  const m = map[value];
  if (!m) return <span className="badge badge-neutral">{value}</span>;
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}

export function OrderStatusPill({ status }: { status: string }) {
  return <Pill map={ORDER_STATUS_MAP} value={status} />;
}

export function FinancialStatusPill({ status }: { status: string }) {
  return <Pill map={FINANCIAL_STATUS_MAP} value={status} />;
}

export function FulfillmentStatusPill({ status }: { status: string }) {
  return <Pill map={FULFILLMENT_STATUS_MAP} value={status} />;
}

export function ReturnStatusPill({ status }: { status: string }) {
  return <Pill map={RETURN_STATUS_MAP} value={status} />;
}

/** Alias zodat bestaande imports (`PaymentStatusPill`) blijven werken. */
export function PaymentStatusPill({ status }: { status: string }) {
  return <Pill map={PAYMENT_STATUS_MAP} value={status} />;
}

/**
 * Connectie-status van een verkoopkanaal (gebruikt door de channels-preview).
 * Behouden voor backwards-compat met `routes/_app/channels.tsx`.
 */
export function ChannelStatusPill({ status }: { status: 'connected' | 'warning' | 'error' | 'paused' }) {
  const map = {
    connected: { label: 'Verbonden', klass: 'badge-success' },
    warning: { label: 'Waarschuwing', klass: 'badge-warning' },
    error: { label: 'Fout', klass: 'badge-danger' },
    paused: { label: 'Gepauzeerd', klass: 'badge-neutral' },
  } as const;
  const m = map[status];
  return <span className={`badge ${m.klass}`}>{m.label}</span>;
}

export function ChannelPill({ slug, compact = false }: { slug: string; compact?: boolean }) {
  const ch = CHANNEL_MAP[slug];
  if (!ch) return <span className="badge badge-neutral">{slug}</span>;
  return (
    <span
      className="badge"
      style={{
        background: 'transparent',
        borderColor: 'var(--border-default)',
        color: 'var(--theme-text)',
        gap: 6,
        paddingLeft: 4,
      }}
      title={ch.label}
    >
      <span
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 16,
          height: 16,
          borderRadius: 4,
          background: ch.color,
          color: '#fff',
          fontSize: 9.5,
          fontWeight: 700,
        }}
      >
        {ch.letter}
      </span>
      {!compact && ch.label}
    </span>
  );
}
