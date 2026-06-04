/**
 * SupplierDrawer — create/edit een leverancier tegen de echte API.
 *
 * Velden: naam, e-mail, telefoon, adres (line1/line2/postcode/city/province/
 * country), lead-time (dagen), currency, notities, actief. Delete als
 * secundaire actie (soft-delete → active=false; backend blokkeert hard-delete
 * met openstaande PO's, dat vangen we hier af).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import {
  useCreateSupplier,
  useUpdateSupplier,
  type Supplier,
  type SupplierInput,
} from './api';

const COUNTRIES = ['NL', 'BE', 'DE', 'FR', 'IT', 'ES', 'GB', 'US'];
const CURRENCIES = ['EUR', 'USD', 'GBP'];

interface Props {
  /** Te bewerken leverancier; null + creating=false ⇒ gesloten. */
  supplier: Supplier | null;
  creating: boolean;
  onClose: () => void;
  onRequestDelete?: (s: Supplier) => void;
}

export function SupplierDrawer({ supplier, creating, onClose, onRequestDelete }: Props) {
  const open = creating || supplier != null;
  const isCreate = creating;

  const createMut = useCreateSupplier();
  const updateMut = useUpdateSupplier();
  const pending = createMut.isPending || updateMut.isPending;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [postcode, setPostcode] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [country, setCountry] = useState('NL');
  const [leadTimeDays, setLeadTimeDays] = useState(7);
  const [currency, setCurrency] = useState('EUR');
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (supplier) {
      setName(supplier.name);
      setEmail(supplier.email ?? '');
      setPhone(supplier.phone ?? '');
      setLine1(supplier.address?.line1 ?? '');
      setLine2(supplier.address?.line2 ?? '');
      setPostcode(supplier.address?.postcode ?? '');
      setCity(supplier.address?.city ?? '');
      setProvince(supplier.address?.province ?? '');
      setCountry(supplier.address?.country ?? 'NL');
      setLeadTimeDays(supplier.leadTimeDays);
      setCurrency(supplier.currency);
      setNotes(supplier.notes ?? '');
      setActive(supplier.active);
    } else {
      setName(''); setEmail(''); setPhone('');
      setLine1(''); setLine2(''); setPostcode(''); setCity(''); setProvince('');
      setCountry('NL'); setLeadTimeDays(7); setCurrency('EUR'); setNotes('');
      setActive(true);
    }
  }, [open, supplier]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Naam is verplicht');
      return;
    }

    const hasAddress = line1 || line2 || postcode || city || province || country;
    const address = hasAddress
      ? {
          ...(line1 ? { line1 } : {}),
          ...(line2 ? { line2 } : {}),
          ...(postcode ? { postcode } : {}),
          ...(city ? { city } : {}),
          ...(province ? { province } : {}),
          ...(country ? { country } : {}),
        }
      : null;

    const payload: SupplierInput = {
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      address,
      leadTimeDays,
      currency,
      notes: notes.trim() || null,
      active,
    };

    try {
      if (isCreate) {
        await createMut.mutateAsync(payload);
        toast.success(`Leverancier ${name} toegevoegd`);
      } else if (supplier) {
        await updateMut.mutateAsync({ id: supplier.id, patch: payload });
        toast.success(`Leverancier ${name} bijgewerkt`);
      }
      onClose();
    } catch (err) {
      const e = asApiError(err);
      toast.error(e.message || 'Opslaan mislukt');
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      title={isCreate ? 'Leverancier toevoegen' : supplier?.name}
      subtitle={isCreate ? 'Inkoop-relatie aanmaken.' : supplier?.email ?? 'Leverancier bewerken'}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            Annuleer
          </button>
          {!isCreate && supplier && onRequestDelete && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => onRequestDelete(supplier)}
              disabled={pending}
            >
              <Trash2 size={13} /> Verwijder
            </button>
          )}
          <button type="submit" form="supplier-form" className="btn btn-primary" disabled={pending}>
            {pending ? 'Bezig…' : isCreate ? 'Aanmaken' : 'Opslaan'}
          </button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={onSubmit}>
        <FormField label="Naam" required>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormField label="E-mail">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label="Telefoon">
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </FormField>
        </div>

        <h3 style={sectionTitleStyle}>Adres</h3>
        <FormField label="Straat + nr">
          <input type="text" value={line1} onChange={(e) => setLine1(e.target.value)} />
        </FormField>
        <FormField label="Adresregel 2">
          <input type="text" value={line2} onChange={(e) => setLine2(e.target.value)} />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
          <FormField label="Postcode">
            <input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} />
          </FormField>
          <FormField label="Stad">
            <input type="text" value={city} onChange={(e) => setCity(e.target.value)} />
          </FormField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}>
          <FormField label="Provincie / regio">
            <input type="text" value={province} onChange={(e) => setProvince(e.target.value)} />
          </FormField>
          <FormField label="Land">
            <select value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
        </div>

        <h3 style={sectionTitleStyle}>Inkoop-condities</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormField label="Lead-time (dagen)">
            <input
              type="number"
              min={0}
              max={365}
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(Math.max(0, Number(e.target.value)))}
            />
          </FormField>
          <FormField label="Valuta">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
        </div>

        <FormField label="Notities">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{ resize: 'vertical', minHeight: 60 }}
          />
        </FormField>

        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
            color: 'var(--theme-text)', padding: '10px 12px',
            background: 'var(--surface-2)', borderRadius: 8, marginTop: 4,
          }}
        >
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            style={{ width: 16, height: 16, padding: 0 }}
          />
          <span>Leverancier actief — bruikbaar voor nieuwe PO's</span>
        </label>
      </form>
    </Drawer>
  );
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--theme-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  margin: '8px 0 8px',
  fontWeight: 600,
};
