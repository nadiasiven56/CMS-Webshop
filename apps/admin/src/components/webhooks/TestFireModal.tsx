/**
 * TestFireModal — vuur handmatig een sample-payload af naar een ad-hoc URL en
 * toon het resultaat (HTTP-status, duur, fout). Mirror van de
 * add-channel-modal-UX. Gebruikt het ad-hoc-pad ({event, url, secret?}); de
 * backend schrijft zelf een delivery-log-rij.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, XCircle, Zap } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import { useTestFire, useWebhookEvents, type TestFireResponse } from './api';

export function TestFireModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const eventsQuery = useWebhookEvents();
  const events = eventsQuery.data ?? [];
  const testFire = useTestFire();

  const [event, setEvent] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [result, setResult] = useState<TestFireResponse | null>(null);

  useEffect(() => {
    if (open) {
      setEvent(events[0] ?? '');
      setUrl('');
      setSecret('');
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Default-event invullen zodra de catalogus geladen is.
  useEffect(() => {
    if (open && !event && events.length > 0) setEvent(events[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!event) {
      toast.error('Kies een event.');
      return;
    }
    if (!url.trim()) {
      toast.error('Vul een doel-URL in.');
      return;
    }
    setResult(null);
    try {
      const res = await testFire.mutateAsync({
        event,
        url: url.trim(),
        secret: secret.trim() || undefined,
      });
      setResult(res);
      if (res.ok) toast.success(`Test-fire geslaagd (HTTP ${res.delivery.responseStatus})`);
      else
        toast.error(
          `Test-fire mislukt${res.delivery.responseStatus != null ? ` (HTTP ${res.delivery.responseStatus})` : ''}`,
        );
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Test-fire mislukt: ${e2.message}`);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Test-fire webhook"
      subtitle="Vuur een sample-payload naar een doel-URL en bekijk de respons."
      maxWidth={540}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Sluiten
          </button>
          <button
            type="submit"
            form="test-fire-form"
            className="btn btn-primary"
            disabled={testFire.isPending}
          >
            <Zap size={14} />
            {testFire.isPending ? 'Afvuren…' : 'Afvuren'}
          </button>
        </>
      }
    >
      <form id="test-fire-form" onSubmit={onSubmit}>
        <FormField label="Event" required>
          <select value={event} onChange={(e) => setEvent(e.target.value)}>
            {events.length === 0 && <option value="">Events laden…</option>}
            {events.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label="Doel-URL"
          required
          hint="De endpoint die de sample-payload ontvangt."
        >
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://voorbeeld.nl/webhooks"
            required
          />
        </FormField>
        <FormField
          label="Secret (optioneel)"
          hint="Voeg een HMAC-secret toe om de signature-header te ondertekenen."
        >
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="••••••••"
            autoComplete="off"
          />
        </FormField>

        {result && (
          <div
            style={{
              marginTop: 6,
              padding: '12px',
              borderRadius: 8,
              background: result.ok ? 'var(--success-soft)' : 'var(--danger-soft)',
              border: `1px solid ${result.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                fontWeight: 600,
                color: result.ok ? 'var(--success)' : 'var(--danger)',
              }}
            >
              {result.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
              {result.ok ? 'Geslaagd' : 'Mislukt'}
              <span style={{ marginLeft: 'auto', fontWeight: 500 }}>
                {result.delivery.responseStatus != null
                  ? `HTTP ${result.delivery.responseStatus}`
                  : 'geen status'}
                {result.delivery.durationMs != null ? ` • ${result.delivery.durationMs} ms` : ''}
              </span>
            </div>
            {result.delivery.errorMessage && (
              <p
                style={{
                  margin: '8px 0 0',
                  fontSize: 12,
                  color: 'var(--danger)',
                  wordBreak: 'break-word',
                }}
              >
                {result.delivery.errorMessage}
              </p>
            )}
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 11.5,
                color: 'var(--theme-muted)',
              }}
            >
              De aflevering is toegevoegd aan het delivery-log hieronder.
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
}
