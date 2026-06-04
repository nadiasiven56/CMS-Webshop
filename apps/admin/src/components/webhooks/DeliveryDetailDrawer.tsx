/**
 * DeliveryDetailDrawer — volledige inzage in één webhook-delivery: de verzonden
 * payload, de request-headers (incl. signature-header) en de response-body.
 *
 * Leest via useDelivery(id) zodra een rij is aangeklikt (de list-DTO bevat de
 * volle payload/response NIET — die zit alleen in het detail-endpoint).
 */
import { CheckCircle2, XCircle } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDateTime } from '@/lib/format';
import { useDelivery, type WebhookDeliveryListDto } from './api';

const SIGNATURE_HEADER_KEYS = ['x-webhook-signature', 'x-signature', 'x-hub-signature-256'];

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: '10px 12px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 11.5,
        lineHeight: 1.5,
        color: 'var(--text-soft)',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {children}
    </pre>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontWeight: 600,
        color: 'var(--theme-muted)',
        margin: '16px 0 6px',
      }}
    >
      {children}
    </div>
  );
}

export function DeliveryDetailDrawer({
  delivery,
  onClose,
}: {
  /** De list-row die is aangeklikt (voor de header), of null als gesloten. */
  delivery: WebhookDeliveryListDto | null;
  onClose: () => void;
}) {
  const open = delivery != null;
  const query = useDelivery(delivery?.id);
  const detail = query.data;

  // Vind de signature-header (case-insensitive) als die er is.
  const headers = detail?.requestHeaders ?? {};
  const signatureEntry = Object.entries(headers).find(([k]) =>
    SIGNATURE_HEADER_KEYS.includes(k.toLowerCase()),
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      title={delivery ? delivery.event : undefined}
      subtitle={delivery ? formatDateTime(delivery.createdAt) : undefined}
      footer={
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Sluiten
        </button>
      }
    >
      {!delivery ? null : (
        <div>
          {/* Samenvatting */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 8,
              background: delivery.success ? 'var(--success-soft)' : 'var(--danger-soft)',
              border: `1px solid ${delivery.success ? 'var(--success-border)' : 'var(--danger-border)'}`,
              color: delivery.success ? 'var(--success)' : 'var(--danger)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {delivery.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {delivery.success ? 'Geslaagd' : 'Mislukt'}
            <span style={{ marginLeft: 'auto', fontWeight: 500 }}>
              {delivery.responseStatus != null ? `HTTP ${delivery.responseStatus}` : 'geen status'}
              {delivery.durationMs != null ? ` • ${delivery.durationMs} ms` : ''}
            </span>
          </div>

          {/* Meta-grid */}
          <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
            <MetaRow label="Event" value={delivery.event} mono />
            <MetaRow label="URL" value={delivery.url} mono />
            <MetaRow label="Poging" value={String(delivery.attempt)} />
            {delivery.webhookId && (
              <MetaRow label="Webhook-ID" value={delivery.webhookId} mono />
            )}
            {delivery.errorMessage && (
              <MetaRow label="Foutmelding" value={delivery.errorMessage} danger />
            )}
          </div>

          {query.isError ? (
            <p className="error-text" style={{ color: 'var(--danger)', marginTop: 16 }}>
              Kon de details niet laden. Probeer opnieuw.
            </p>
          ) : query.isLoading || !detail ? (
            <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
              <Skeleton height={20} width="40%" />
              <Skeleton height={90} />
              <Skeleton height={70} />
            </div>
          ) : (
            <>
              {/* Signature-header */}
              <SectionLabel>Signature-header</SectionLabel>
              {signatureEntry ? (
                <CodeBlock>{`${signatureEntry[0]}: ${signatureEntry[1]}`}</CodeBlock>
              ) : (
                <p style={{ fontSize: 12.5, color: 'var(--theme-muted)', margin: 0 }}>
                  Geen signature-header aanwezig (geen secret ingesteld).
                </p>
              )}

              {/* Volledige request-headers */}
              {detail.requestHeaders && Object.keys(detail.requestHeaders).length > 0 && (
                <>
                  <SectionLabel>Request-headers</SectionLabel>
                  <CodeBlock>{prettyJson(detail.requestHeaders)}</CodeBlock>
                </>
              )}

              {/* Payload */}
              <SectionLabel>Payload</SectionLabel>
              {detail.payload != null ? (
                <CodeBlock>{prettyJson(detail.payload)}</CodeBlock>
              ) : (
                <p style={{ fontSize: 12.5, color: 'var(--theme-muted)', margin: 0 }}>
                  Geen payload opgeslagen.
                </p>
              )}

              {/* Response-body */}
              <SectionLabel>Response-body</SectionLabel>
              {detail.responseBody ? (
                <CodeBlock>{detail.responseBody}</CodeBlock>
              ) : (
                <p style={{ fontSize: 12.5, color: 'var(--theme-muted)', margin: 0 }}>
                  Geen response-body (geen respons ontvangen).
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

function MetaRow({
  label,
  value,
  mono,
  danger,
}: {
  label: string;
  value: string;
  mono?: boolean;
  danger?: boolean;
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
        style={{
          color: danger ? 'var(--danger)' : 'var(--text-soft)',
          wordBreak: 'break-word',
          fontSize: mono ? 11.5 : 12.5,
        }}
      >
        {value}
      </span>
    </div>
  );
}
