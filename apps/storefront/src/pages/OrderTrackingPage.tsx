/**
 * Order-tracking: een klant zoekt met zijn ordernummer de actuele betaal-/
 * order-status op via GET /orders/:orderNumber/status (shop-scoped, de client
 * stuurt X-Shop-Slug mee). Simpel en publiek — geen login nodig.
 */
import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { ShopLink } from '../components/ShopLink';
import { Spinner } from '../components/States';
import { useDocumentHead } from '../lib/useDocumentHead';
import { formatMoneyIn } from '../lib/format';
import { useShop } from '../state/ShopProvider';
import type { OrderStatusResponse } from '../api/types';

type State = 'paid' | 'failed' | 'pending';

const STATUS_META: Record<State, { icon: string; label: string; hint: string }> = {
  paid: {
    icon: '✅',
    label: 'Betaald',
    hint: 'Je betaling is ontvangen. We maken je bestelling klaar voor verzending.',
  },
  pending: {
    icon: '⏳',
    label: 'In behandeling',
    hint: 'We wachten op de bevestiging van je betaling. Dit kan even duren.',
  },
  failed: {
    icon: '⚠️',
    label: 'Mislukt of geannuleerd',
    hint: 'De betaling is niet afgerond. Plaats je bestelling eventueel opnieuw.',
  },
};

export function OrderTrackingPage() {
  const { shop } = useShop();
  const shopName = shop?.name ?? 'Webshop';

  useDocumentHead({
    title: `Bestelling volgen — ${shopName}`,
    description: `Volg de status van je bestelling bij ${shopName} met je bestelnummer.`,
  });

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OrderStatusResponse['order'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const orderNumber = input.trim();
    setError(null);
    setResult(null);
    if (!orderNumber) {
      setError('Vul je bestelnummer in.');
      return;
    }
    setLoading(true);
    try {
      const { order } = await api.getOrderStatus(orderNumber);
      setResult(order);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(
          'We konden geen bestelling met dit nummer vinden in deze winkel. Controleer het nummer.',
        );
      } else {
        setError('Status ophalen mislukte. Probeer het later opnieuw.');
      }
    } finally {
      setLoading(false);
    }
  };

  const meta = result ? STATUS_META[result.state as State] : null;

  return (
    <div className="container">
      <div className="tracking-page">
        <h1 style={{ marginTop: 28 }}>Bestelling volgen</h1>
        <p style={{ color: 'var(--text-muted)', maxWidth: 560 }}>
          Vul je bestelnummer in (bijvoorbeeld uit je bevestigingsmail) om de
          actuele status van je betaling en bestelling te zien.
        </p>

        <form onSubmit={handleSubmit} className="tracking-form">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="orderNumber">Bestelnummer</label>
            <input
              id="orderNumber"
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Bijv. CR-1001"
              autoComplete="off"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading}
          >
            {loading ? 'Zoeken…' : 'Zoek bestelling'}
          </button>
        </form>

        {loading && <Spinner label="Status ophalen…" />}

        {error && (
          <div className="alert alert-error" style={{ marginTop: 16 }}>
            {error}
          </div>
        )}

        {result && meta && (
          <div className="tracking-result">
            <div className="tracking-result__head">
              <span className="tracking-result__icon" aria-hidden>
                {meta.icon}
              </span>
              <div>
                <span className="product-card__vendor">
                  Bestelling {result.orderNumber}
                </span>
                <h2 style={{ margin: '2px 0 0' }}>{meta.label}</h2>
              </div>
            </div>
            <p style={{ color: 'var(--text-muted)' }}>{meta.hint}</p>
            <div className="summary-row total" style={{ marginTop: 8 }}>
              <span>Bedrag</span>
              <span>
                {formatMoneyIn(
                  result.grandTotal,
                  shop?.locale,
                  result.currency || shop?.currency,
                )}
              </span>
            </div>
            {result.state === 'failed' && (
              <ShopLink
                to="/cart"
                className="btn btn-primary btn-lg"
                style={{ marginTop: 16 }}
              >
                Opnieuw bestellen
              </ShopLink>
            )}
          </div>
        )}

        {shop?.supportEmail && (
          <p className="product-card__vendor" style={{ marginTop: 28 }}>
            Iets niet duidelijk? Mail ons op{' '}
            <a href={`mailto:${shop.supportEmail}`}>{shop.supportEmail}</a>
          </p>
        )}
      </div>
    </div>
  );
}
