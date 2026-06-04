import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export interface AdjustSubmitInput {
  delta: number;
  reason: string;
  note?: string;
  force?: boolean;
}

interface Props {
  open: boolean;
  locationName: string;
  locationId: string;
  currentOnHand: number;
  currentAvailable: number;
  itemSku: string;
  pending?: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onSubmit: (input: AdjustSubmitInput) => Promise<void> | void;
}

const REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'receive', label: 'Ontvangst (receive)' },
  { value: 'damage', label: 'Beschadigd (damage)' },
  { value: 'loss', label: 'Verloren (loss)' },
  { value: 'audit', label: 'Telling-correctie (audit)' },
  { value: 'manual', label: 'Handmatig (manual)' },
];

export function StockAdjustModal({
  open,
  locationName,
  locationId,
  currentOnHand,
  currentAvailable,
  itemSku,
  pending,
  errorMessage,
  onClose,
  onSubmit,
}: Props) {
  const [delta, setDelta] = useState<string>('');
  const [reason, setReason] = useState<string>('receive');
  const [note, setNote] = useState<string>('');
  const [force, setForce] = useState<boolean>(false);

  // Reset op open
  useEffect(() => {
    if (open) {
      setDelta('');
      setReason('receive');
      setNote('');
      setForce(false);
    }
  }, [open]);

  // ESC sluit
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const deltaNum = Number.parseInt(delta, 10);
  const deltaValid = Number.isInteger(deltaNum) && deltaNum !== 0;
  const projectedOnHand = deltaValid ? currentOnHand + deltaNum : currentOnHand;
  const projectedAvailable = deltaValid
    ? currentAvailable + deltaNum
    : currentAvailable;
  const willGoNegative = projectedOnHand < 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!deltaValid) return;
    await onSubmit({
      delta: deltaNum,
      reason,
      note: note.trim() || undefined,
      force,
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="adjust-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 480,
          padding: 20,
          background: 'var(--theme-card, #15181d)',
          border: '1px solid var(--theme-border, rgba(255,255,255,0.08))',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 16,
          }}
        >
          <div>
            <h2 id="adjust-modal-title" style={{ margin: 0, fontSize: 18 }}>
              Voorraad aanpassen
            </h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {itemSku} · {locationName}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Sluiten"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--theme-muted)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="adjust-delta"
              style={{ display: 'block', fontSize: 12, marginBottom: 4 }}
              className="muted"
            >
              Delta (gebruik bv. <code>+5</code> of <code>-3</code>)
            </label>
            <input
              id="adjust-delta"
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="+5"
              required
              autoFocus
              style={{
                width: '100%',
                padding: '8px 10px',
                background: 'var(--theme-card2, rgba(255,255,255,0.04))',
                border: '1px solid var(--theme-border, rgba(255,255,255,0.1))',
                borderRadius: 6,
                color: 'var(--theme-text)',
                fontSize: 16,
              }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="adjust-reason"
              style={{ display: 'block', fontSize: 12, marginBottom: 4 }}
              className="muted"
            >
              Reden
            </label>
            <select
              id="adjust-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                background: 'var(--theme-card2, rgba(255,255,255,0.04))',
                border: '1px solid var(--theme-border, rgba(255,255,255,0.1))',
                borderRadius: 6,
                color: 'var(--theme-text)',
                fontSize: 14,
              }}
            >
              {REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="adjust-note"
              style={{ display: 'block', fontSize: 12, marginBottom: 4 }}
              className="muted"
            >
              Toelichting (optioneel)
            </label>
            <textarea
              id="adjust-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="bv. Telfout — geverifieerd door J."
              style={{
                width: '100%',
                padding: '8px 10px',
                background: 'var(--theme-card2, rgba(255,255,255,0.04))',
                border: '1px solid var(--theme-border, rgba(255,255,255,0.1))',
                borderRadius: 6,
                color: 'var(--theme-text)',
                fontSize: 14,
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Preview */}
          {deltaValid && (
            <div
              style={{
                background: 'var(--theme-card2, rgba(255,255,255,0.04))',
                border: '1px solid var(--theme-border, rgba(255,255,255,0.08))',
                borderRadius: 6,
                padding: 10,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              <div className="muted" style={{ marginBottom: 4 }}>
                Resultaat:
              </div>
              <div>
                On hand: {currentOnHand} → <strong>{projectedOnHand}</strong>
              </div>
              <div>
                Available: {currentAvailable} → <strong>{projectedAvailable}</strong>
              </div>
              {willGoNegative && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 8,
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 4,
                    color: '#fca5a5',
                  }}
                >
                  <strong>⚠ Negatief on_hand:</strong> default geweigerd. Vink
                  &quot;force&quot; aan om door te zetten.
                </div>
              )}
            </div>
          )}

          {willGoNegative && deltaValid && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
              />
              Force: sta toe dat on_hand negatief wordt
            </label>
          )}

          {errorMessage && (
            <div
              role="alert"
              style={{
                padding: 10,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 6,
                color: '#fca5a5',
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {errorMessage}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={pending}
            >
              Annuleren
            </button>
            <button
              type="submit"
              className="btn"
              disabled={!deltaValid || pending || (willGoNegative && !force)}
              style={{
                background: 'var(--theme-accent, #ff9f43)',
                color: '#0d0f12',
                fontWeight: 600,
              }}
            >
              {pending ? 'Opslaan…' : 'Adjust opslaan'}
            </button>
          </div>

          <input type="hidden" value={locationId} readOnly />
        </form>
      </div>
    </div>
  );
}
