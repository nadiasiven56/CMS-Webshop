/**
 * DiscountDrawer — maak of bewerk één kortingscode op de ECHTE API
 * (`POST /api/discounts` / `PATCH /api/discounts/:id`).
 *
 * Alle velden uit DiscountCreateSchema: code, type, value, shopId, currency,
 * minSubtotal, startsAt/endsAt, maxRedemptions, maxPerCustomer, active,
 * description. Het type-select stuurt of `value` een percentage of een
 * geldbedrag is; voor free_shipping verbergen we het value-veld helemaal.
 *
 * Geld blijft een STRING (Money-conventie). Datums sturen we als ISO-string
 * (datetime-local → ISO). Een leeg optioneel veld → null/undefined.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import { useShopList } from '@/components/shops/api';
import {
  useCreateDiscount,
  useUpdateDiscount,
  discountTypeMeta,
  DISCOUNT_TYPE_META,
  type DiscountDto,
  type DiscountType,
} from './api';

/** ISO-string → waarde voor <input type=datetime-local> (lokale tz, zonder sec). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local-waarde → ISO-string (of null als leeg). */
function localInputToIso(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function DiscountDrawer({
  discount,
  open,
  onClose,
}: {
  /** De te bewerken korting, of null voor "nieuw". */
  discount: DiscountDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const isEdit = discount != null;
  const discountId = discount?.id ?? '';

  const create = useCreateDiscount();
  const update = useUpdateDiscount(discountId);
  const shopsQuery = useShopList({ limit: 100, offset: 0 });
  const shops = shopsQuery.data?.items ?? [];

  const [code, setCode] = useState('');
  const [type, setType] = useState<DiscountType>('percentage');
  const [value, setValue] = useState('');
  const [shopId, setShopId] = useState<string>(''); // '' = globaal
  const [currency, setCurrency] = useState('EUR');
  const [minSubtotal, setMinSubtotal] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [maxPerCustomer, setMaxPerCustomer] = useState('');
  const [active, setActive] = useState(true);
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    if (discount) {
      setCode(discount.code);
      setType((discount.type as DiscountType) ?? 'percentage');
      setValue(discount.value);
      setShopId(discount.shopId ?? '');
      setCurrency(discount.currency || 'EUR');
      setMinSubtotal(discount.minSubtotal ?? '');
      setStartsAt(isoToLocalInput(discount.startsAt));
      setEndsAt(isoToLocalInput(discount.endsAt));
      setMaxRedemptions(discount.maxRedemptions != null ? String(discount.maxRedemptions) : '');
      setMaxPerCustomer(discount.maxPerCustomer != null ? String(discount.maxPerCustomer) : '');
      setActive(discount.active);
      setDescription(discount.description ?? '');
    } else {
      setCode('');
      setType('percentage');
      setValue('');
      setShopId('');
      setCurrency('EUR');
      setMinSubtotal('');
      setStartsAt('');
      setEndsAt('');
      setMaxRedemptions('');
      setMaxPerCustomer('');
      setActive(true);
      setDescription('');
    }
  }, [open, discount]);

  const meta = discountTypeMeta(type);
  const showValue = meta.valueKind !== 'none';
  const saving = create.isPending || update.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmedCode = code.trim();
    if (!trimmedCode) {
      toast.error('Vul een code in.');
      return;
    }
    if (showValue && !value.trim()) {
      toast.error('Vul een waarde in voor dit kortingstype.');
      return;
    }

    // free_shipping negeert value (backend default '0'); anders de ingevulde waarde.
    const payload = {
      code: trimmedCode,
      type,
      value: type === 'free_shipping' ? undefined : value.trim(),
      shopId: shopId || null,
      currency: currency.trim().toUpperCase() || 'EUR',
      minSubtotal: minSubtotal.trim() ? minSubtotal.trim() : null,
      startsAt: localInputToIso(startsAt),
      endsAt: localInputToIso(endsAt),
      maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions.trim()) : null,
      maxPerCustomer: maxPerCustomer.trim() ? Number(maxPerCustomer.trim()) : null,
      active,
      description: description.trim() ? description.trim() : null,
    };

    try {
      if (isEdit) {
        await update.mutateAsync(payload);
        toast.success(`Code ${trimmedCode.toUpperCase()} bijgewerkt`);
      } else {
        await create.mutateAsync(payload);
        toast.success(`Code ${trimmedCode.toUpperCase()} aangemaakt`);
      }
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      if (e2.code === 'duplicate_code') {
        toast.error('Deze code bestaat al binnen deze scope (shop of globaal).');
      } else {
        toast.error(`Opslaan mislukt: ${e2.message}`);
      }
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? `Code ${discount?.code}` : 'Nieuwe kortingscode'}
      subtitle={isEdit ? 'Bewerk de voorwaarden' : 'Maak een nieuwe korting aan'}
      width={560}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleer
          </button>
          <button type="submit" form="discount-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Opslaan…' : isEdit ? 'Opslaan' : 'Aanmaken'}
          </button>
        </>
      }
    >
      <form id="discount-form" onSubmit={onSubmit}>
        <FormField label="Code" required hint="Letters, cijfers en . _ - — wordt UPPERCASE opgeslagen.">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            placeholder="WELKOM10"
            style={{ textTransform: 'uppercase' }}
          />
        </FormField>

        <FormField label="Type" hint={meta.hint}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
            {(Object.keys(DISCOUNT_TYPE_META) as DiscountType[]).map((k) => {
              const tm = discountTypeMeta(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setType(k)}
                  style={{
                    padding: '10px 10px',
                    background: type === k ? 'var(--theme-accent-subtle)' : 'var(--surface-2)',
                    border: type === k ? '1px solid var(--theme-accent-border)' : '1px solid var(--border-default)',
                    borderRadius: 9,
                    cursor: 'pointer',
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: type === k ? 'var(--theme-accent)' : 'var(--text-soft)',
                  }}
                >
                  {tm.label}
                </button>
              );
            })}
          </div>
        </FormField>

        {showValue && (
          <FormField
            label={meta.valueKind === 'percent' ? 'Percentage' : 'Bedrag'}
            required
            hint={
              meta.valueKind === 'percent'
                ? 'Bv. 10 voor 10% korting.'
                : `Vast bedrag in ${currency || 'EUR'} (bv. 5.00).`
            }
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {meta.valueKind === 'amount' && (
                <span style={{ color: 'var(--theme-muted)', fontSize: 13 }}>{currency || 'EUR'}</span>
              )}
              <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={meta.valueKind === 'percent' ? '10' : '5.00'}
                style={{ flex: 1 }}
              />
              {meta.valueKind === 'percent' && (
                <span style={{ color: 'var(--theme-muted)', fontSize: 13 }}>%</span>
              )}
            </div>
          </FormField>
        )}

        <FormField label="Geldt voor" hint="Globaal of beperkt tot één shop.">
          <select value={shopId} onChange={(e) => setShopId(e.target.value)}>
            <option value="">Alle shops (globaal)</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Valuta" hint="3-letterige ISO-code (bv. EUR).">
          <input
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            maxLength={3}
            placeholder="EUR"
            style={{ textTransform: 'uppercase', maxWidth: 120 }}
          />
        </FormField>

        <FormField label="Min. subtotaal" hint="Optioneel — minimaal te besteden bedrag.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--theme-muted)', fontSize: 13 }}>{currency || 'EUR'}</span>
            <input
              type="text"
              inputMode="decimal"
              value={minSubtotal}
              onChange={(e) => setMinSubtotal(e.target.value)}
              placeholder="50.00"
              style={{ flex: 1 }}
            />
          </div>
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Start" hint="Optioneel.">
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </FormField>
          <FormField label="Einde" hint="Optioneel — moet ná start liggen.">
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </FormField>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Max. totaal" hint="Max. aantal inwisselingen.">
            <input
              type="number"
              min={1}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              placeholder="onbeperkt"
            />
          </FormField>
          <FormField label="Max. per klant" hint="Per e-mailadres.">
            <input
              type="number"
              min={1}
              value={maxPerCustomer}
              onChange={(e) => setMaxPerCustomer(e.target.value)}
              placeholder="onbeperkt"
            />
          </FormField>
        </div>

        <FormField label="Omschrijving" hint="Optioneel — interne notitie.">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ resize: 'vertical' }}
            placeholder="Bv. zomeractie nieuwsbrief"
          />
        </FormField>

        <FormField label="Status">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              style={{ width: 'auto' }}
            />
            {active ? 'Actief (inwisselbaar)' : 'Uitgeschakeld'}
          </label>
        </FormField>
      </form>
    </Drawer>
  );
}
