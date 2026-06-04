/**
 * AddressDrawer — create + edit van een klant-adres via edit-drawer.
 *
 * - `mode="create"`: POST /api/customers/:id/addresses
 * - `mode="edit"`:   PATCH /api/customers/:id/addresses/:addressId
 *
 * Velden: type (billing|shipping), is_default, naam, line1/line2, postcode,
 * stad, provincie, land (ISO-2), telefoon. Het zetten van is_default unset
 * server-side de andere defaults van hetzelfde type.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toastBus } from '@/components/ui/Toast';
import { asApiError } from '@/lib/api';
import {
  useCreateAddress,
  useUpdateAddress,
  type AddressType,
  type CustomerAddressDto,
} from './api';

const COUNTRY_OPTIONS = [
  'NL', 'BE', 'DE', 'FR', 'IT', 'ES', 'GB', 'SE', 'PL', 'AT', 'PT', 'IE', 'CH', 'DK', 'LU',
] as const;

interface FormState {
  type: AddressType;
  isDefault: boolean;
  name: string;
  line1: string;
  line2: string;
  postcode: string;
  city: string;
  province: string;
  country: string;
  phone: string;
}

const EMPTY: FormState = {
  type: 'shipping',
  isDefault: false,
  name: '',
  line1: '',
  line2: '',
  postcode: '',
  city: '',
  province: '',
  country: 'NL',
  phone: '',
};

function fromAddress(a: CustomerAddressDto): FormState {
  return {
    type: a.type === 'billing' ? 'billing' : 'shipping',
    isDefault: a.isDefault,
    name: a.name ?? '',
    line1: a.line1 ?? '',
    line2: a.line2 ?? '',
    postcode: a.postcode ?? '',
    city: a.city ?? '',
    province: a.province ?? '',
    country: a.country ?? 'NL',
    phone: a.phone ?? '',
  };
}

interface BaseProps {
  open: boolean;
  onClose: () => void;
  customerId: string;
}

type Props =
  | (BaseProps & { mode: 'create'; address?: undefined })
  | (BaseProps & { mode: 'edit'; address: CustomerAddressDto });

export function AddressDrawer(props: Props) {
  const { open, onClose, customerId, mode } = props;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateAddress(customerId);
  const update = useUpdateAddress(customerId);
  const saving = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit') setForm(fromAddress(props.address));
    else setForm(EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, mode === 'edit' ? props.address?.id : null]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const country = form.country.trim().toUpperCase();
    if (country.length !== 2) {
      setError('Land moet een ISO-2 code zijn (bv. NL).');
      return;
    }

    const payload = {
      type: form.type,
      isDefault: form.isDefault,
      name: form.name.trim() || null,
      line1: form.line1.trim() || null,
      line2: form.line2.trim() || null,
      postcode: form.postcode.trim() || null,
      city: form.city.trim() || null,
      province: form.province.trim() || null,
      country,
      phone: form.phone.trim() || null,
    };

    try {
      if (mode === 'create') {
        await create.mutateAsync(payload);
        toastBus.push('success', 'Adres toegevoegd');
      } else {
        await update.mutateAsync({ addressId: props.address.id, patch: payload });
        toastBus.push('success', 'Adres bijgewerkt');
      }
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      const msg =
        e2.code === 'invalid_request'
          ? 'Controleer de ingevulde adres-velden.'
          : e2.code === 'not_found'
            ? 'Adres of klant niet gevonden.'
            : 'Opslaan mislukt. Probeer het opnieuw.';
      setError(msg);
      toastBus.push('error', msg);
    }
  }

  const formId = 'address-drawer-form';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      title={mode === 'create' ? 'Adres toevoegen' : 'Adres bewerken'}
      subtitle={mode === 'create' ? 'Verzend- of factuuradres' : undefined}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleer
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn-primary"
            disabled={saving}
          >
            {saving ? 'Opslaan…' : mode === 'create' ? 'Toevoegen' : 'Opslaan'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit}>
        {error && (
          <div
            className="error-text"
            style={{
              marginBottom: 14,
              padding: '8px 12px',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger-border)',
              borderRadius: 8,
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}

        <FormField label="Type">
          <div className="segmented">
            <button
              type="button"
              data-active={form.type === 'shipping'}
              onClick={() => set('type', 'shipping')}
            >
              Verzending
            </button>
            <button
              type="button"
              data-active={form.type === 'billing'}
              onClick={() => set('type', 'billing')}
            >
              Facturatie
            </button>
          </div>
        </FormField>

        <FormField label="Naam / t.a.v.">
          <input
            type="text"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Jan de Vries"
            autoFocus
          />
        </FormField>

        <FormField label="Adres (regel 1)">
          <input
            type="text"
            value={form.line1}
            onChange={(e) => set('line1', e.target.value)}
            placeholder="Straat + huisnummer"
          />
        </FormField>
        <FormField label="Adres (regel 2)">
          <input
            type="text"
            value={form.line2}
            onChange={(e) => set('line2', e.target.value)}
            placeholder="Toevoeging (optioneel)"
          />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
          <FormField label="Postcode">
            <input
              type="text"
              value={form.postcode}
              onChange={(e) => set('postcode', e.target.value)}
            />
          </FormField>
          <FormField label="Plaats">
            <input
              type="text"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
            />
          </FormField>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
          <FormField label="Provincie / regio">
            <input
              type="text"
              value={form.province}
              onChange={(e) => set('province', e.target.value)}
            />
          </FormField>
          <FormField label="Land">
            <select
              value={form.country}
              onChange={(e) => set('country', e.target.value)}
            >
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="Telefoon">
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="+31 6 12345678"
          />
        </FormField>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            padding: '10px 12px',
            background: 'var(--surface-2)',
            borderRadius: 8,
            marginTop: 4,
          }}
        >
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => set('isDefault', e.target.checked)}
            style={{ width: 16, height: 16, padding: 0 }}
          />
          Standaard {form.type === 'billing' ? 'factuuradres' : 'verzendadres'}
        </label>
      </form>
    </Drawer>
  );
}
