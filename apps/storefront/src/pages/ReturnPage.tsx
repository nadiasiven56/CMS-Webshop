/**
 * Terugkeerpagina na een PSP-betaling (bv. Mollie).
 *
 * Mollie redirect de koper hierheen (zie buildRedirectUrl in de API). De
 * betaling wordt server-to-server door de webhook bevestigd, die vóór of ná
 * deze redirect kan aankomen — daarom pollen we de order-status tot 'paid' of
 * 'failed', of we vallen na een paar pogingen terug op 'in behandeling'.
 *
 * De mock-flow (geen PSP) komt hier niet: die gaat direct naar /bedankt.
 *
 * Cart: bij een GESLAAGDE betaling legen we de lokale cart-token alsnog (de
 * CheckoutPage liet hem bewust staan, zodat een geannuleerde betaling
 * terugkeerbaar bleef). Bij 'failed'/'pending' blijft de cart staan zodat de
 * klant het opnieuw kan proberen.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { ShopLink } from '../components/ShopLink';
import { useCart } from '../state/CartProvider';
import { useShop } from '../state/ShopProvider';

type View = 'checking' | 'paid' | 'pending' | 'failed' | 'missing';

const MAX_POLLS = 8;
// Verzachte backoff: start kort, loop op tot ~5s zodat we de server niet
// platleggen terwijl de webhook nog onderweg is.
function pollDelay(attempt: number): number {
  return Math.min(1500 + attempt * 600, 5000);
}

export function ReturnPage() {
  const [params] = useSearchParams();
  const orderNumber = params.get('order');
  const { shop } = useShop();
  const { clearLocal } = useCart();
  const [view, setView] = useState<View>(orderNumber ? 'checking' : 'missing');
  const pollsRef = useRef(0);
  // bumpen om een herstart van het pollen te forceren ("opnieuw controleren")
  const [restartNonce, setRestartNonce] = useState(0);

  useEffect(() => {
    if (!orderNumber) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNext = () => {
      if (pollsRef.current >= MAX_POLLS) {
        setView('pending');
        return;
      }
      const delay = pollDelay(pollsRef.current);
      pollsRef.current += 1;
      timer = setTimeout(poll, delay);
    };

    const poll = async () => {
      try {
        const { order } = await api.getOrderStatus(orderNumber);
        if (cancelled) return;
        if (order.state === 'paid') {
          // Betaling bevestigd → lokale cart nu pas legen.
          clearLocal();
          return setView('paid');
        }
        if (order.state === 'failed') return setView('failed');
        scheduleNext(); // pending → nog even doorpollen
      } catch {
        if (cancelled) return;
        // bv. 404 omdat de order net is aangemaakt → blijf kort pollen
        scheduleNext();
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // restartNonce in deps → "opnieuw controleren" herstart het pollen.
  }, [orderNumber, restartNonce, clearLocal]);

  const recheck = useCallback(() => {
    pollsRef.current = 0;
    setView('checking');
    setRestartNonce((n) => n + 1);
  }, []);

  const orderRef = orderNumber ? (
    <strong style={{ color: 'var(--brand-primary)' }}>{orderNumber}</strong>
  ) : null;

  let icon = '⏳';
  let title = 'Betaling controleren…';
  let body: ReactNode = <p>Een moment geduld, we bevestigen je betaling.</p>;
  let action: ReactNode = null;

  if (view === 'paid') {
    icon = '✅';
    title = 'Betaling geslaagd!';
    body = (
      <p>
        Bedankt voor je bestelling. Je bestelnummer is {orderRef}. Je ontvangt een
        bevestiging per e-mail.
      </p>
    );
    action = (
      <ShopLink to="/shop" className="btn btn-primary btn-lg" style={{ marginTop: 16 }}>
        Verder winkelen
      </ShopLink>
    );
  } else if (view === 'pending') {
    icon = '⏳';
    title = 'Betaling in behandeling';
    body = (
      <p>
        We hebben je betaling voor {orderRef ?? 'je bestelling'} nog niet
        definitief bevestigd. Dit kan even duren — zodra de betaling rond is
        ontvang je een bevestiging per e-mail.
      </p>
    );
    action = (
      <div className="return-actions">
        <button
          className="btn btn-primary btn-lg"
          style={{ marginTop: 16 }}
          onClick={recheck}
        >
          Status opnieuw controleren
        </button>
        <ShopLink to="/shop" className="btn btn-outline btn-lg" style={{ marginTop: 16 }}>
          Verder winkelen
        </ShopLink>
      </div>
    );
  } else if (view === 'failed') {
    icon = '⚠️';
    title = 'Betaling niet gelukt';
    body = (
      <p>
        De betaling voor {orderRef ?? 'je bestelling'} is geannuleerd of mislukt.
        Er is niets afgeschreven. Je producten staan nog in je winkelwagen — je
        kunt het opnieuw proberen.
      </p>
    );
    action = (
      <div className="return-actions">
        <ShopLink to="/checkout" className="btn btn-primary btn-lg" style={{ marginTop: 16 }}>
          Opnieuw proberen
        </ShopLink>
        <ShopLink to="/cart" className="btn btn-outline btn-lg" style={{ marginTop: 16 }}>
          Naar winkelwagen
        </ShopLink>
      </div>
    );
  } else if (view === 'missing') {
    icon = '⚠️';
    title = 'Geen bestelling gevonden';
    body = <p>We konden geen bestelnummer terugvinden in deze link.</p>;
    action = (
      <ShopLink to="/shop" className="btn btn-primary btn-lg" style={{ marginTop: 16 }}>
        Naar de winkel
      </ShopLink>
    );
  }

  return (
    <div className="container">
      <div className="state" style={{ paddingTop: 80 }}>
        <div style={{ fontSize: 56, marginBottom: 8 }} aria-hidden>
          {icon}
        </div>
        <h1>{title}</h1>
        {body}
        {view === 'failed' && shop?.supportEmail && (
          <p className="product-card__vendor">
            Hulp nodig? Mail ons op{' '}
            <a href={`mailto:${shop.supportEmail}`}>{shop.supportEmail}</a>
          </p>
        )}
        {action}
      </div>
    </div>
  );
}
