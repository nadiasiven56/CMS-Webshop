/**
 * Create-order drawer — maakt een echte order via POST /api/orders.
 *
 * Shop-scoped: gebruikt de actieve shop. Klant optioneel (picker uit echte
 * /api/customers). Eén of meer regels met sku/titel/aantal/prijs(+ optioneel
 * inkoopprijs voor marge). Verzend- en kortingstotaal optioneel.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { useActiveShop } from '@/lib/shop-context';
import { asApiError } from '@/lib/api';
import {
  useCreateOrder,
  useCustomerOptions,
  type CreateOrderItemInput,
} from './api';
import { money, toNumber } from './money';

interface DraftLine {
  key: string;
  sku: string;
  title: string;
  quantity: number;
  unitPrice: string;
  costPrice: string;
  taxRate: string;
}

function newLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    sku: '',
    title: '',
    quantity: 1,
    unitPrice: '',
    costPrice: '',
    taxRate: '21',
  };
}

const CHANNELS = [
  { value: 'web', label: 'Webshop' },
  { value: 'bol', label: 'Bol.com' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'gmc', label: 'Google' },
];

export function CreateOrderDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (orderId: string) => void;
}) {
  const { activeShopId } = useActiveShop();
  const create = useCreateOrder();

  const [customerId, setCustomerId] = useState('');
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState('web');
  const [note, setNote] = useState('');
  const [shippingTotal, setShippingTotal] = useState('');
  const [discountTotal, setDiscountTotal] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [customerSearch, setCustomerSearch] = useState('');

  const customersQuery = useCustomerOptions(activeShopId, customerSearch);

  // Reset bij openen
  useEffect(() => {
    if (open) {
      setCustomerId('');
      setEmail('');
      setChannel('web');
      setNote('');
      setShippingTotal('');
      setDiscountTotal('');
      setLines([newLine()]);
      setCustomerSearch('');
    }
  }, [open]);

  const totals = useMemo(() => {
    let subInclTax = 0;
    for (const l of lines) {
      const price = toNumber(l.unitPrice);
      subInclTax += price * l.quantity;
    }
    const ship = toNumber(shippingTotal);
    const disc = toNumber(discountTotal);
    return { lines: subInclTax, grand: subInclTax + ship - disc };
  }, [lines, shippingTotal, discountTotal]);

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeShopId) {
      toast.error('Geen actieve shop');
      return;
    }
    const validLines = lines.filter((l) => toNumber(l.unitPrice) > 0 && l.quantity > 0);
    if (validLines.length === 0) {
      toast.error('Voeg minstens één regel met een prijs toe');
      return;
    }

    const items: CreateOrderItemInput[] = validLines.map((l) => ({
      sku: l.sku.trim() || null,
      title: l.title.trim() || null,
      quantity: l.quantity,
      unitPrice: String(toNumber(l.unitPrice)),
      taxRate: l.taxRate || '21',
      costPrice: l.costPrice.trim() ? String(toNumber(l.costPrice)) : null,
    }));

    create.mutate(
      {
        shopId: activeShopId,
        customerId: customerId || null,
        email: email.trim() || null,
        channel,
        items,
        shippingTotal: shippingTotal.trim() ? String(toNumber(shippingTotal)) : undefined,
        discountTotal: discountTotal.trim() ? String(toNumber(discountTotal)) : undefined,
        note: note.trim() || null,
        placed: true,
      },
      {
        onSuccess: (order) => {
          toast.success(`Order ${order.orderNumber} aangemaakt`);
          onCreated(order.id);
        },
        onError: (err) => {
          const e = asApiError(err);
          toast.error(`Aanmaken mislukt: ${e.message}`);
        },
      },
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Handmatige order"
      subtitle="Maak een order aan zonder storefront-checkout."
      width={560}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleer
          </button>
          <button
            type="submit"
            form="create-order-form"
            className="btn btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? 'Aanmaken…' : 'Order aanmaken'}
          </button>
        </>
      }
    >
      <form id="create-order-form" onSubmit={onSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormField label="Klant (optioneel)">
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Geen / gast —</option>
              {(customersQuery.data ?? []).map((c) => {
                const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
                const label = name || c.company || c.email || c.id;
                return (
                  <option key={c.id} value={c.id}>
                    {label}{c.email ? ` — ${c.email}` : ''}
                  </option>
                );
              })}
            </select>
          </FormField>
          <FormField label="Kanaal">
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="E-mail (optioneel)" hint="Voor gast-orders zonder klantkoppeling.">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="klant@voorbeeld.nl"
          />
        </FormField>

        {/* Regels */}
        <div style={{ marginTop: 8, marginBottom: 6, fontSize: 12, fontWeight: 500, color: 'var(--theme-muted)' }}>
          Regels
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lines.map((l, idx) => (
            <div
              key={l.key}
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                padding: 10,
                background: 'var(--surface-2)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11.5, color: 'var(--theme-muted)' }}>Regel {idx + 1}</span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ width: 26, height: 26, color: 'var(--danger)' }}
                    onClick={() => removeLine(l.key)}
                    aria-label="Verwijder regel"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <FormField label="SKU">
                  <input value={l.sku} onChange={(e) => updateLine(l.key, { sku: e.target.value })} placeholder="SKU-001" />
                </FormField>
                <FormField label="Titel">
                  <input value={l.title} onChange={(e) => updateLine(l.key, { title: e.target.value })} placeholder="Productnaam" />
                </FormField>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                <FormField label="Aantal">
                  <input
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={(e) => updateLine(l.key, { quantity: Math.max(1, Number(e.target.value)) })}
                  />
                </FormField>
                <FormField label="Prijs (incl)">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.unitPrice}
                    onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                    placeholder="0,00"
                  />
                </FormField>
                <FormField label="Inkoop">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.costPrice}
                    onChange={(e) => updateLine(l.key, { costPrice: e.target.value })}
                    placeholder="optioneel"
                  />
                </FormField>
                <FormField label="BTW %">
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={l.taxRate}
                    onChange={(e) => updateLine(l.key, { taxRate: e.target.value })}
                  />
                </FormField>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ marginTop: 8 }}
          onClick={() => setLines((prev) => [...prev, newLine()])}
        >
          <Plus size={13} /> Regel toevoegen
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
          <FormField label="Verzendkosten">
            <input
              type="number"
              min={0}
              step="0.01"
              value={shippingTotal}
              onChange={(e) => setShippingTotal(e.target.value)}
              placeholder="0,00"
            />
          </FormField>
          <FormField label="Korting">
            <input
              type="number"
              min={0}
              step="0.01"
              value={discountTotal}
              onChange={(e) => setDiscountTotal(e.target.value)}
              placeholder="0,00"
            />
          </FormField>
        </div>

        <FormField label="Notitie (optioneel)">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            style={{ resize: 'vertical', minHeight: 48 }}
            placeholder="Interne notitie"
          />
        </FormField>

        <div
          style={{
            marginTop: 8,
            padding: '12px 14px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>Geschat totaal (incl. BTW)</span>
            <strong style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{money(totals.grand)}</strong>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-faint)' }}>
            Definitieve BTW-splitsing wordt server-side berekend.
          </div>
        </div>
      </form>
    </Drawer>
  );
}
