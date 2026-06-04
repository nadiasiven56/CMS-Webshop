/**
 * CustomerDrawer — create + edit van een klant via één edit-drawer.
 *
 * - `mode="create"`: vereist een `shopId`; POST /api/customers.
 * - `mode="edit"`:   vereist een bestaande `customer`; PATCH /api/customers/:id.
 *
 * ESC + backdrop sluiten (via <Drawer>), footer Annuleer/Opslaan. Toasts op
 * success/fout via de globale `toastBus`. Verplichte velden: e-mail.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toastBus } from '@/components/ui/Toast';
import { asApiError } from '@/lib/api';
import {
  useCreateCustomer,
  useUpdateCustomer,
  type CustomerDto,
} from './api';

interface FormState {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  company: string;
  vatNumber: string;
  acceptsMarketing: boolean;
  tags: string;
  notes: string;
}

const EMPTY: FormState = {
  email: '',
  firstName: '',
  lastName: '',
  phone: '',
  company: '',
  vatNumber: '',
  acceptsMarketing: false,
  tags: '',
  notes: '',
};

function fromCustomer(c: CustomerDto): FormState {
  return {
    email: c.email,
    firstName: c.firstName ?? '',
    lastName: c.lastName ?? '',
    phone: c.phone ?? '',
    company: c.company ?? '',
    vatNumber: c.vatNumber ?? '',
    acceptsMarketing: c.acceptsMarketing,
    tags: c.tags.join(', '),
    notes: c.notes ?? '',
  };
}

interface BaseProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (customer: CustomerDto) => void;
}

type Props =
  | (BaseProps & { mode: 'create'; shopId: string | null; customer?: undefined })
  | (BaseProps & { mode: 'edit'; customer: CustomerDto; shopId?: undefined });

export function CustomerDrawer(props: Props) {
  const { open, onClose, onSaved, mode } = props;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateCustomer();
  // Hooks mogen niet conditioneel zijn → altijd aanroepen met een stabiel id.
  const update = useUpdateCustomer(mode === 'edit' ? props.customer.id : '__none__');
  const saving = create.isPending || update.isPending;

  // (Re)seed het formulier wanneer de drawer opent of de klant wisselt.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit') {
      setForm(fromCustomer(props.customer));
    } else {
      setForm(EMPTY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, mode === 'edit' ? props.customer?.id : null]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function parseTags(): string[] {
    return form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const email = form.email.trim();
    if (!email) {
      setError('E-mail is verplicht.');
      return;
    }

    try {
      if (mode === 'create') {
        if (!props.shopId) {
          setError('Geen actieve shop geselecteerd.');
          return;
        }
        const customer = await create.mutateAsync({
          shopId: props.shopId,
          email,
          firstName: form.firstName.trim() || null,
          lastName: form.lastName.trim() || null,
          phone: form.phone.trim() || null,
          company: form.company.trim() || null,
          vatNumber: form.vatNumber.trim() || null,
          acceptsMarketing: form.acceptsMarketing,
          tags: parseTags(),
          notes: form.notes.trim() || null,
        });
        toastBus.push('success', `Klant ${customer.email} aangemaakt`);
        onSaved?.(customer);
        onClose();
      } else {
        const customer = await update.mutateAsync({
          email,
          firstName: form.firstName.trim() || null,
          lastName: form.lastName.trim() || null,
          phone: form.phone.trim() || null,
          company: form.company.trim() || null,
          vatNumber: form.vatNumber.trim() || null,
          acceptsMarketing: form.acceptsMarketing,
          tags: parseTags(),
          notes: form.notes.trim() || null,
        });
        toastBus.push('success', `Klant ${customer.email} bijgewerkt`);
        onSaved?.(customer);
        onClose();
      }
    } catch (err) {
      const e2 = asApiError(err);
      const msg =
        e2.code === 'email_taken'
          ? 'Dit e-mailadres is al in gebruik binnen deze shop.'
          : e2.code === 'shop_not_found'
            ? 'De geselecteerde shop bestaat niet meer.'
            : e2.code === 'invalid_request'
              ? 'Controleer de ingevulde velden.'
              : 'Opslaan mislukt. Probeer het opnieuw.';
      setError(msg);
      toastBus.push('error', msg);
    }
  }

  const formId = 'customer-drawer-form';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      title={mode === 'create' ? 'Klant toevoegen' : 'Klant bewerken'}
      subtitle={
        mode === 'create'
          ? 'Maak een nieuw klant-record aan.'
          : props.customer.email
      }
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
            {saving ? 'Opslaan…' : mode === 'create' ? 'Aanmaken' : 'Opslaan'}
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

        <FormField label="E-mail" required>
          <input
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            required
            placeholder="jan@voorbeeld.nl"
            autoFocus
          />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormField label="Voornaam">
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
            />
          </FormField>
          <FormField label="Achternaam">
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)}
            />
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

        <div
          style={{
            padding: 12,
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          <h3
            style={{
              margin: '0 0 10px',
              fontSize: 12,
              color: 'var(--theme-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Bedrijf (B2B)
          </h3>
          <FormField label="Bedrijfsnaam">
            <input
              type="text"
              value={form.company}
              onChange={(e) => set('company', e.target.value)}
              placeholder="Acme BV"
            />
          </FormField>
          <FormField
            label="BTW-nummer"
            hint="Bij een ingevuld BTW-nummer wordt de klant als B2B gemarkeerd."
          >
            <input
              type="text"
              value={form.vatNumber}
              onChange={(e) => set('vatNumber', e.target.value)}
              placeholder="NL123456789B01"
              className="mono"
            />
          </FormField>
        </div>

        <FormField label="Tags" hint="Komma-gescheiden, bijv. vip, wholesale">
          <input
            type="text"
            value={form.tags}
            onChange={(e) => set('tags', e.target.value)}
            placeholder="vip, wholesale"
          />
        </FormField>

        <FormField label="Notitie">
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            style={{ resize: 'vertical', minHeight: 60 }}
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
            checked={form.acceptsMarketing}
            onChange={(e) => set('acceptsMarketing', e.target.checked)}
            style={{ width: 16, height: 16, padding: 0 }}
          />
          Marketing opt-in (nieuwsbrief + acties)
        </label>
      </form>
    </Drawer>
  );
}
