import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { ShopLink } from '../components/ShopLink';
import { EmptyState, Spinner } from '../components/States';
import { useCart, useCartToken } from '../state/CartProvider';
import { formatMoney } from '../lib/format';
import { withShopQuery } from '../api/shop-context';
import type { CheckoutBody } from '../api/types';

interface FormState {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  line1: string;
  postcode: string;
  city: string;
  country: string;
}

const EMPTY: FormState = {
  email: '',
  firstName: '',
  lastName: '',
  phone: '',
  line1: '',
  postcode: '',
  city: '',
  country: 'NL',
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
  if (f.country.trim().length !== 2) e.country = '2-letterige landcode';
  return e;
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, loading, clearLocal } = useCart();
  const token = useCartToken();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const set =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length > 0) return;

    const body: CheckoutBody = {
      email: form.email.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim() || undefined,
      acceptsMarketing: false,
      shippingAddress: {
        name: `${form.firstName} ${form.lastName}`.trim(),
        line1: form.line1.trim(),
        postcode: form.postcode.trim(),
        city: form.city.trim(),
        country: form.country.trim().toUpperCase(),
      },
    };

    setSubmitting(true);
    try {
      const result = await api.checkout(token, body);
      // cart is server-side geleegd → lokale token weg.
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
      } else if (err instanceof ApiError && err.code === 'invalid_request') {
        setServerError('Controleer je gegevens en probeer opnieuw.');
      } else {
        setServerError('Afrekenen mislukte. Probeer het later opnieuw.');
      }
    } finally {
      setSubmitting(false);
    }
  };

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
              <label htmlFor="country">Land (code) *</label>
              <input
                id="country"
                className="input"
                value={form.country}
                onChange={set('country')}
                maxLength={2}
                autoComplete="country"
              />
              {errors.country && (
                <span className="field-error">{errors.country}</span>
              )}
            </div>
          </div>

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
            {submitting
              ? 'Bestelling plaatsen…'
              : `Betaal ${formatMoney(cart?.subtotal)}`}
          </button>
          <p
            className="product-card__vendor"
            style={{ marginTop: 10, textAlign: 'center' }}
          >
            Betaling via mock-provider — er wordt niets afgeschreven (demo).
          </p>
        </form>

        <aside className="summary-card">
          <h3 style={{ marginTop: 0 }}>Je bestelling</h3>
          {items.map((line) => (
            <div className="summary-row" key={line.id}>
              <span>
                {line.quantity}× {line.title}
              </span>
              <span>{formatMoney(line.lineTotal)}</span>
            </div>
          ))}
          <div className="summary-row total">
            <span>Totaal</span>
            <span>{formatMoney(cart?.subtotal)}</span>
          </div>
          <ShopLink
            to="/cart"
            className="btn btn-outline btn-block"
            style={{ marginTop: 14 }}
          >
            Wagen aanpassen
          </ShopLink>
        </aside>
      </div>
    </div>
  );
}
