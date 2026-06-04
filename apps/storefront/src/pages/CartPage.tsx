import { useState } from 'react';
import { ShopLink } from '../components/ShopLink';
import { EmptyState, Spinner } from '../components/States';
import { useCart } from '../state/CartProvider';
import { useToast } from '../state/ToastProvider';
import { formatMoney } from '../lib/format';
import { ApiError } from '../api/client';
import type { CartLine } from '../api/types';

function CartRow({
  line,
  onUpdate,
  onRemove,
  busy,
}: {
  line: CartLine;
  onUpdate: (qty: number) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const canIncrease = line.quantity < line.available;
  return (
    <div className="cart-line">
      <div className="cart-line__media">
        {line.imageUrl ? <img src={line.imageUrl} alt={line.title ?? ''} /> : null}
      </div>
      <div className="cart-line__meta">
        <strong>{line.title ?? 'Product'}</strong>
        {line.sku && (
          <span className="product-card__vendor">{line.sku}</span>
        )}
        <span>{formatMoney(line.unitPrice)} / stuk</span>
        <div className="qty-stepper" style={{ marginTop: 4 }}>
          <button
            onClick={() => onUpdate(line.quantity - 1)}
            disabled={busy}
            aria-label="Minder"
          >
            −
          </button>
          <span>{line.quantity}</span>
          <button
            onClick={() => onUpdate(line.quantity + 1)}
            disabled={busy || !canIncrease}
            aria-label="Meer"
          >
            +
          </button>
        </div>
      </div>
      <div className="cart-line__right">
        <strong>{formatMoney(line.lineTotal)}</strong>
        <button
          className="btn-ghost"
          onClick={onRemove}
          disabled={busy}
          style={{ color: 'var(--danger)' }}
        >
          Verwijderen
        </button>
      </div>
    </div>
  );
}

export function CartPage() {
  const { cart, loading, updateItem, removeItem } = useCart();
  const toast = useToast();
  const [rowBusy, setRowBusy] = useState(false);

  const handleUpdate = async (itemId: string, qty: number) => {
    setRowBusy(true);
    try {
      await updateItem(itemId, qty);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'insufficient_stock') {
        const avail = (err.details as { available?: number })?.available;
        toast.push(
          `Niet genoeg voorraad${
            typeof avail === 'number' ? ` (max ${avail})` : ''
          }.`,
          'error',
        );
      } else {
        toast.push('Aanpassen mislukte.', 'error');
      }
    } finally {
      setRowBusy(false);
    }
  };

  const handleRemove = async (itemId: string) => {
    setRowBusy(true);
    try {
      await removeItem(itemId);
      toast.push('Verwijderd uit je wagen', 'info');
    } catch {
      toast.push('Verwijderen mislukte.', 'error');
    } finally {
      setRowBusy(false);
    }
  };

  if (loading && !cart) {
    return (
      <div className="container">
        <Spinner label="Winkelwagen laden…" />
      </div>
    );
  }

  const items = cart?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="container">
        <EmptyState
          title="Je winkelwagen is leeg"
          message="Ontdek ons assortiment en voeg iets toe."
          action={
            <ShopLink to="/shop" className="btn btn-primary">
              Naar de shop
            </ShopLink>
          }
        />
      </div>
    );
  }

  return (
    <div className="container">
      <h1 style={{ marginTop: 28 }}>Winkelwagen</h1>
      <div className="cart-layout">
        <div>
          {items.map((line) => (
            <CartRow
              key={line.id}
              line={line}
              busy={rowBusy}
              onUpdate={(q) => handleUpdate(line.id, q)}
              onRemove={() => handleRemove(line.id)}
            />
          ))}
        </div>

        <aside className="summary-card">
          <h3 style={{ marginTop: 0 }}>Overzicht</h3>
          <div className="summary-row">
            <span>Subtotaal ({cart?.itemCount} items)</span>
            <span>{formatMoney(cart?.subtotal)}</span>
          </div>
          <div className="summary-row">
            <span>Verzending</span>
            <span>Berekend bij afrekenen</span>
          </div>
          <div className="summary-row total">
            <span>Totaal</span>
            <span>{formatMoney(cart?.subtotal)}</span>
          </div>
          <ShopLink
            to="/checkout"
            className="btn btn-primary btn-block btn-lg"
            style={{ marginTop: 16 }}
          >
            Afrekenen
          </ShopLink>
          <ShopLink
            to="/shop"
            className="btn btn-outline btn-block"
            style={{ marginTop: 10 }}
          >
            Verder winkelen
          </ShopLink>
        </aside>
      </div>
    </div>
  );
}
