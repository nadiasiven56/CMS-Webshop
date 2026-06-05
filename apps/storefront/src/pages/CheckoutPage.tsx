import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { ShopLink } from '../components/ShopLink';
import { EmptyState, Spinner } from '../components/States';
import { useCart, useCartToken } from '../state/CartProvider';
import { useShop } from '../state/ShopProvider';
import { formatMoneyIn } from '../lib/format';
import { withShopQuery } from '../api/shop-context';
import type { CheckoutBody, OrderResult } from '../api/types';

/** EU-landen (ISO-3166-alpha2) voor de bezorgadres-select. */
const COUNTRIES: { code: string; label: string }[] = [
  { code: 'NL', label: 'Nederland' },
  { code: 'BE', label: 'België' },
  { code: 'DE', label: 'Duitsland' },
  { code: 'FR', label: 'Frankrijk' },
  { code: 'LU', label: 'Luxemburg' },
  { code: 'AT', label: 'Oostenrijk' },
  { code: 'ES', label: 'Spanje' },
  { code: 'IT', label: 'Italië' },
];

interface FormState {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  company: string;
  vatNumber: string;
  line1: string;
  postcode: string;
  city: string;
  country: string;
  discountCode: string;
}

const EMPTY: FormState = {
  email: '',
  firstName: '',
  lastName: '',
  phone: '',
  company: '',
  vatNumber: '',
  line1: '',
  postcode: '',
  city: '',
  country: 'NL',
  discountCode: '',
};

function validate(f: FormState): Partial<Record<keyof FormState, string>> {
  const e: Partial<Record<keyof FormState, string>> = {};
  if (!f.email.trim()) e.email = 'E-mail is verplicht';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Ongeldig e-mailadres';
  if (!f.firstName.trim()) e.firstName = 'Verplicht';
  if (!f.lastName.trim()) e.lastName = 'Verplicht';
  if (!f.line1.trim()) e.line1 = 'Straat + huisnummer verplicht';
  if (!f.postcode.trim()) e.postcode = 'Postcode verplicht';
  if (!f.city.trim()) e.city = 'Plaats verplicht';
  if (f.country.trim().length !== 2) e.country = 'Kies een land';
  return e;
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, loading, clearLocal } = useCart();
  const { shop } = useShop();
  const token = useCartToken();
  const locale = shop?.locale;
  const currency = cart?.currency ?? shop?.currency;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showBusiness, setShowBusiness] = useState(false);
  // Volledig besteloverzicht zodra de order is geplaatst (PSP-flow toont dit
  // vóór de redirect; mock-flow gaat direct door naar /bedankt).
  const [placed, setPlaced] = useState<OrderResult | null>(null);

  const set =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  if (loading && !cart) {
    return (
      <div className="container">
        <Spinner label="Laden…" />
      </div>
    );
  }

  const items = cart?.items ?? [];
  if (!token || items.length === 0) {
    return (
      <div className="container">
        <EmptyState
          title="Niets om af te rekenen"
          message="Je winkelwagen is leeg."
          action={
            <ShopLink to="/shop" className="btn btn-primary">
              Naar de shop
            </ShopLink>
          }
        />
      </div>
    );
  }

  const money = (v: string | number | null | undefined) =>
    formatMoneyIn(v, locale, currency);

  // Cart-subtotaal is BRUTO (incl. btw) — dat is het bedrag dat de klant nu ziet.
  // Het volledige overzicht (netto-subtotaal, btw-split, korting, verzending)
  // komt pas terug in de OrderResult na het plaatsen.
  const cartSubtotal = cart?.subtotal ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length > 0) return;

    const company = form.company.trim();
    const vatNumber = form.vatNumber.trim();
    const discountCode = form.discountCode.trim();

    const body: CheckoutBody = {
      email: form.email.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim() || undefined,
      company: company || undefined,
      vatNumber: vatNumber || undefined,
      acceptsMarketing: false,
      ...(discountCode ? { discountCode } : {}),
      shippingAddress: {
        name: `${form.firstName} ${form.lastName}`.trim(),
        company: company || undefined,
        line1: form.line1.trim(),
        postcode: form.postcode.trim(),
        city: form.city.trim(),
        country: form.country.trim().toUpperCase(),
        phone: form.phone.trim() || undefined,
      },
    };

    setSubmitting(true);
    try {
      const result = await api.checkout(token, body);

      // PSP-flow (bv. Mollie): de backend geeft een checkoutUrl terug → stuur de
      // klant naar de externe betaalpagina. We mogen de cart NIET lokaal legen
      // vóór de redirect: bij een geannuleerde/mislukte betaling moet de klant
      // terug kunnen naar zijn winkelwagen. De order staat op "pending_payment";
      // de PSP-webhook bevestigt 'm en Mollie redirect terug naar
      // /checkout/return.
      const checkoutUrl = result.payment?.checkoutUrl;
      if (checkoutUrl) {
        setPlaced(result); // toon bevestigd overzicht onder de redirect-knop
        window.location.href = checkoutUrl;
        return;
      }

      // Mock-flow: betaling is bevestigd (direct 'paid') → nú pas de cart legen.
      clearLocal();
      navigate(
        withShopQuery(
          `/bedankt?order=${encodeURIComponent(result.order.orderNumber)}`,
        ),
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'insufficient_stock') {
        setServerError(
          'Een van je producten is niet meer (volledig) op voorraad. Pas je winkelwagen aan.',
        );
      } else if (err instanceof ApiError && err.code === 'invalid_discount') {
        setServerError(
          'De ingevoerde kortingscode is niet (meer) geldig. Controleer de code of laat hem leeg.',
        );
        setErrors((e) => ({ ...e, discountCode: 'Ongeldige code' }));
      } else if (err instanceof ApiError && err.code === 'invalid_request') {
        setServerError('Controleer je gegevens en probeer opnieuw.');
      } else {
        setServerError('Afrekenen mislukte. Probeer het later opnieuw.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Het uiteindelijke te-betalen bedrag: na plaatsing exact (order.grandTotal),
  // anders het bruto cart-subtotaal (verzending/korting/btw rekenen we definitief
  // op de server).
  const payAmount = placed?.order.grandTotal ?? cartSubtotal;
  const order = placed?.order;
  const hasDiscount = order ? Number(order.discountTotal) > 0 : false;
  const hasShipping = order ? Number(order.shippingTotal) > 0 : false;

  return (
    <div className="container">
      <h1 style={{ marginTop: 28 }}>Afrekenen</h1>
      <div className="cart-layout">
        <form onSubmit={handleSubmit} noValidate>
          <h3>Contact</h3>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="email">E-mailadres *</label>
              <input
                id="email"
                className="input"
                type="email"
                inputMode="email"
                value={form.email}
                onChange={set('email')}
                autoComplete="email"
              />
              {errors.email && <span className="field-error">{errors.email}</span>}
            </div>
            <div className="field">
              <label htmlFor="firstName">Voornaam *</label>
              <input
                id="firstName"
                className="input"
                value={form.firstName}
                onChange={set('firstName')}
                autoComplete="given-name"
              />
              {errors.firstName && (
                <span className="field-error">{errors.firstName}</span>
              )}
            </div>
            <div className="field">
              <label htmlFor="lastName">Achternaam *</label>
              <input
                id="lastName"
                className="input"
                value={form.lastName}
                onChange={set('lastName')}
                autoComplete="family-name"
              />
              {errors.lastName && (
                <span className="field-error">{errors.lastName}</span>
              )}
            </div>
            <div className="field">
              <label htmlFor="phone">Telefoon</label>
              <input
                id="phone"
                className="input"
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={set('phone')}
                autoComplete="tel"
              />
            </div>
          </div>

          <h3 style={{ marginTop: 24 }}>Bezorgadres</h3>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="line1">Straat + huisnummer *</label>
              <input
                id="line1"
                className="input"
                value={form.line1}
                onChange={set('line1')}
                autoComplete="address-line1"
              />
              {errors.line1 && <span className="field-error">{errors.line1}</span>}
            </div>
            <div className="field">
              <label htmlFor="postcode">Postcode *</label>
              <input
                id="postcode"
                className="input"
                inputMode="numeric"
                value={form.postcode}
                onChange={set('postcode')}
                autoComplete="postal-code"
              />
              {errors.postcode && (
                <span className="field-error">{errors.postcode}</span>
              )}
            </div>
            <div className="field">
              <label htmlFor="city">Plaats *</label>
              <input
                id="city"
                className="input"
                value={form.city}
                onChange={set('city')}
                autoComplete="address-level2"
              />
              {errors.city && <span className="field-error">{errors.city}</span>}
            </div>
            <div className="field">
              <label htmlFor="country">Land *</label>
              <select
                id="country"
                className="select"
                value={form.country}
                onChange={set('country')}
                autoComplete="country"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              {errors.country && (
                <span className="field-error">{errors.country}</span>
              )}
            </div>
          </div>

          {/* ── Zakelijke bestelling (optioneel) ── */}
          <button
            type="button"
            className="btn-ghost"
            style={{ marginTop: 16, paddingLeft: 0 }}
            aria-expanded={showBusiness}
            onClick={() => setShowBusiness((s) => !s)}
          >
            {showBusiness ? '− ' : '+ '}Zakelijke bestelling (bedrijfsnaam / btw)
          </button>
          {showBusiness && (
            <div className="form-grid" style={{ marginTop: 8 }}>
              <div className="field">
                <label htmlFor="company">Bedrijfsnaam</label>
                <input
                  id="company"
                  className="input"
                  value={form.company}
                  onChange={set('company')}
                  autoComplete="organization"
                />
              </div>
              <div className="field">
                <label htmlFor="vatNumber">Btw-nummer</label>
                <input
                  id="vatNumber"
                  className="input"
                  value={form.vatNumber}
                  onChange={set('vatNumber')}
                  placeholder="NL000099998B57"
                />
              </div>
            </div>
          )}

          {serverError && (
            <div className="alert alert-error" style={{ marginTop: 16 }}>
              {serverError}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            style={{ marginTop: 22 }}
            disabled={submitting}
          >
            {submitting ? 'Bestelling plaatsen…' : `Betaal ${money(payAmount)}`}
          </button>

          {/* Trust: veilig betalen */}
          <p className="checkout-trust" style={{ marginTop: 12 }}>
            <span aria-hidden>🔒</span> Veilig betalen via een beveiligde
            verbinding (SSL). Je gegevens worden versleuteld verstuurd.
          </p>
        </form>

        <aside className="summary-card">
          <h3 style={{ marginTop: 0 }}>Je bestelling</h3>
          {items.map((line) => (
            <div className="summary-row" key={line.id}>
              <span>
                {line.quantity}× {line.title}
              </span>
              <span>{money(line.lineTotal)}</span>
            </div>
          ))}

          <div className="summary-divider" />

          {/* Vóór plaatsing tonen we het bruto cart-subtotaal; ná plaatsing het
              volledige, definitieve overzicht uit de order. */}
          {order ? (
            <>
              <div className="summary-row">
                <span>Subtotaal (excl. btw)</span>
                <span>{money(order.subtotal)}</span>
              </div>
              {hasDiscount && (
                <div className="summary-row" style={{ color: 'var(--success)' }}>
                  <span>Korting</span>
                  <span>− {money(order.discountTotal)}</span>
                </div>
              )}
              <div className="summary-row">
                <span>Verzending</span>
                <span>{hasShipping ? money(order.shippingTotal) : 'Gratis'}</span>
              </div>
              <div className="summary-row">
                <span>Btw</span>
                <span>{money(order.taxTotal)}</span>
              </div>
              <div className="summary-row total">
                <span>Totaal</span>
                <span>{money(order.grandTotal)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="summary-row">
                <span>Subtotaal</span>
                <span>{money(cartSubtotal)}</span>
              </div>
              <div className="summary-row summary-row--muted">
                <span>Verzending &amp; btw</span>
                <span>Berekend bij plaatsen</span>
              </div>
              <div className="summary-row total">
                <span>Totaal</span>
                <span>{money(cartSubtotal)}</span>
              </div>
            </>
          )}

          {/* ── Kortingscode ── */}
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="discountCode">Kortingscode (optioneel)</label>
            <input
              id="discountCode"
              className="input"
              value={form.discountCode}
              onChange={set('discountCode')}
              placeholder="Bijv. WELKOM10"
              autoCapitalize="characters"
            />
            {errors.discountCode && (
              <span className="field-error">{errors.discountCode}</span>
            )}
            <span className="product-card__vendor" style={{ marginTop: 4 }}>
              De korting wordt verrekend bij het plaatsen van je bestelling.
            </span>
          </div>

          <ShopLink
            to="/cart"
            className="btn btn-outline btn-block"
            style={{ marginTop: 14 }}
          >
            Wagen aanpassen
          </ShopLink>

          {/* Demo-disclaimer: alleen in de mock-flow (geen echte PSP). Zodra een
              PSP-betaling is gestart (checkoutUrl) is dit géén demo meer. */}
          {!placed?.payment.checkoutUrl && (
            <p
              className="product-card__vendor"
              style={{ marginTop: 12, textAlign: 'center' }}
            >
              Demo-omgeving: betaling via mock-provider — er wordt niets
              afgeschreven.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
