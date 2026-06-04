/**
 * AuditDetailDrawer — inzage in één audit-entry: actor, actie, entiteit, ip,
 * en een before/after-samenvatting (de backend levert al een compacte top-level
 * summary, geen volle state).
 *
 * Leest via useAuditEntry(id) zodra een rij is aangeklikt.
 */
import { Drawer } from '@/components/ui/Drawer';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDateTime } from '@/lib/format';
import {
  useAuditEntry,
  actionBadgeClass,
  actorLabel,
  type AuditEntryDto,
} from './api';

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** Verenig de keys van before+after en toon ze naast elkaar (diff-stijl). */
function StateDiff({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const keys = Array.from(
    new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ).sort();

  if (keys.length === 0) {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--theme-muted)', margin: 0 }}>
        Geen voor/na-staat vastgelegd.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 1, background: 'var(--border-subtle)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '130px 1fr 1fr',
          gap: 1,
          background: 'var(--surface-2)',
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 600,
          color: 'var(--theme-muted)',
        }}
      >
        <span style={{ padding: '7px 10px' }}>Veld</span>
        <span style={{ padding: '7px 10px' }}>Voor</span>
        <span style={{ padding: '7px 10px' }}>Na</span>
      </div>
      {keys.map((k) => {
        const b = before ? before[k] : undefined;
        const a = after ? after[k] : undefined;
        const changed = formatValue(b) !== formatValue(a);
        return (
          <div
            key={k}
            style={{
              display: 'grid',
              gridTemplateColumns: '130px 1fr 1fr',
              gap: 1,
              background: 'var(--surface-1, var(--theme-card))',
              fontSize: 12,
            }}
          >
            <span
              style={{
                padding: '7px 10px',
                color: 'var(--theme-muted)',
                wordBreak: 'break-word',
              }}
            >
              {k}
            </span>
            <span
              className="mono"
              style={{
                padding: '7px 10px',
                fontSize: 11.5,
                color: 'var(--text-soft)',
                wordBreak: 'break-word',
              }}
            >
              {formatValue(b)}
            </span>
            <span
              className="mono"
              style={{
                padding: '7px 10px',
                fontSize: 11.5,
                color: changed ? 'var(--theme-accent)' : 'var(--text-soft)',
                fontWeight: changed ? 600 : 400,
                wordBreak: 'break-word',
              }}
            >
              {formatValue(a)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr',
        gap: 10,
        fontSize: 12.5,
        alignItems: 'baseline',
      }}
    >
      <span style={{ color: 'var(--theme-muted)' }}>{label}</span>
      <span
        className={mono ? 'mono' : undefined}
        style={{ color: 'var(--text-soft)', wordBreak: 'break-word', fontSize: mono ? 11.5 : 12.5 }}
      >
        {value}
      </span>
    </div>
  );
}

export function AuditDetailDrawer({
  entry,
  onClose,
}: {
  /** De list-row die is aangeklikt (voor de header), of null als gesloten. */
  entry: AuditEntryDto | null;
  onClose: () => void;
}) {
  const open = entry != null;
  const query = useAuditEntry(entry?.id);
  const detail = query.data ?? entry;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={620}
      title={entry ? `${entry.action} • ${entry.entityType}` : undefined}
      subtitle={entry ? formatDateTime(entry.createdAt) : undefined}
      footer={
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Sluiten
        </button>
      }
    >
      {!entry || !detail ? null : (
        <div>
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            <MetaRow
              label="Actie"
              value={<span className={`badge ${actionBadgeClass(detail.action)}`}>{detail.action}</span>}
            />
            <MetaRow label="Entiteit" value={detail.entityType} />
            {detail.entityId && <MetaRow label="Entiteit-ID" value={detail.entityId} mono />}
            <MetaRow
              label="Actor"
              value={`${actorLabel(detail.actor)}${detail.actor.id ? ` (${detail.actor.id})` : ''}`}
            />
            <MetaRow label="IP-adres" value={detail.ip ?? '—'} mono />
            <MetaRow label="Tijd" value={formatDateTime(detail.createdAt)} />
          </div>

          {query.isError && (
            <p className="error-text" style={{ color: 'var(--danger)', marginBottom: 12 }}>
              Kon de volledige entry niet laden — toon samenvatting uit de lijst.
            </p>
          )}
          {query.isLoading && !query.data && (
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              <Skeleton height={18} width="30%" />
              <Skeleton height={70} />
            </div>
          )}

          <div
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
              color: 'var(--theme-muted)',
              margin: '4px 0 8px',
            }}
          >
            Wijziging (voor → na)
          </div>
          <StateDiff before={detail.before} after={detail.after} />
        </div>
      )}
    </Drawer>
  );
}
