/**
 * ValidatePanel — "Code testen". Roept de admin-preview-endpoint
 * (`POST /api/discounts/validate`) aan met een sample-subtotaal en toont de
 * berekende korting óf de reden waarom de code niet geldig is.
 *
 * Muteert NIETS — het is puur een preview. `{valid:false}` is geen fout (HTTP
 * 200), dus we tonen de reason/message als info, niet als error.
 */
import { useState, type FormEvent } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { FormField } from '@/components/ui/FormField';
import { asApiError } from '@/lib/api';
import { useValidateDiscount, type ValidateResult } from './api';

export function ValidatePanel({ defaultCode = '' }: { defaultCode?: string }) {
  const validate = useValidateDiscount();
  const [code, setCode] = useState(defaultCode);
  const [subtotal, setSubtotal] = useState('100.00');
  const [shipping, setShipping] = useState('5.95');
  const [customerEmail, setCustomerEmail] = useState('');
  const [result, setResult] = useState<ValidateResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    setErrorMsg(null);
    if (!code.trim() || !subtotal.trim()) return;
    try {
      const res = await validate.mutateAsync({
        code: code.trim(),
        subtotal: subtotal.trim(),
        shipping: shipping.trim() || undefined,
        customer_email: customerEmail.trim() || undefined,
      });
      setResult(res);
    } catch (err) {
      const e2 = asApiError(err);
      setErrorMsg(e2.message);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Code testen</h2>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--theme-muted)', marginTop: -4, marginBottom: 14, lineHeight: 1.5 }}>
        Valideer een code tegen een voorbeeld-subtotaal. Dit is een preview — er
        wordt niets ingewisseld.
      </p>

      <form onSubmit={onSubmit}>
        <FormField label="Code" required>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="WELKOM10"
            style={{ textTransform: 'uppercase' }}
            required
          />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Subtotaal" required>
            <input
              type="text"
              inputMode="decimal"
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
              placeholder="100.00"
              required
            />
          </FormField>
          <FormField label="Verzending">
            <input
              type="text"
              inputMode="decimal"
              value={shipping}
              onChange={(e) => setShipping(e.target.value)}
              placeholder="5.95"
            />
          </FormField>
        </div>

        <FormField label="Klant-e-mail" hint="Optioneel — test de per-klant-limiet.">
          <input
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="klant@voorbeeld.nl"
          />
        </FormField>

        <button type="submit" className="btn btn-secondary btn-sm" disabled={validate.isPending}>
          {validate.isPending ? 'Testen…' : 'Test code'}
        </button>
      </form>

      {errorMsg && (
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '10px 12px', borderRadius: 8, marginTop: 14, fontSize: 12.5,
            background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', color: 'var(--danger)',
          }}
        >
          <XCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{errorMsg}</span>
        </div>
      )}

      {result && (
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '10px 12px', borderRadius: 8, marginTop: 14, fontSize: 12.5, lineHeight: 1.5,
            background: result.valid ? 'var(--success-soft)' : 'var(--surface-2)',
            border: `1px solid ${result.valid ? 'var(--success-border)' : 'var(--border-default)'}`,
            color: result.valid ? 'var(--success)' : 'var(--text-soft)',
          }}
        >
          {result.valid ? (
            <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          ) : (
            <XCircle size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--theme-muted)' }} />
          )}
          {result.valid ? (
            <span>
              <strong>Geldig.</strong>{' '}
              {result.freeShipping
                ? 'Gratis verzending wordt toegepast.'
                : `Korting: ${result.discount} ${result.currency}.`}
            </span>
          ) : (
            <span>
              <strong>Niet geldig</strong> ({result.reason}) — {result.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
