import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Package } from 'lucide-react';
import { api, asApiError } from '@/lib/api';
import { getStockItem, DEMO_MODE } from '@/lib/api-with-fallback';
import {
  LocationStockCard,
  type LocationStock,
} from '@/components/stock/LocationStockCard';
import {
  StockAdjustModal,
  type AdjustSubmitInput,
} from '@/components/stock/StockAdjustModal';
import { MovementsTable, type MovementRow } from '@/components/stock/MovementsTable';
import { KpiCard } from '@/components/ui/KpiCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { toastBus } from '@/components/ui/Toast';

export const Route = createFileRoute('/_app/stock/$itemId')({
  component: StockDetailPage,
});

interface StockDetail {
  itemId: string;
  sku: string;
  tracked: boolean;
  requiresShipping: boolean;
  gtin: string | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  variant: { id: string; sku: string | null } | null;
  product: { id: string; title: string | null; status: string | null } | null;
  totals: { onHand: number; available: number; committed: number; incoming: number };
  locations: LocationStock[];
  recentMovements: MovementRow[];
}

function StockDetailPage() {
  const { itemId } = Route.useParams();
  const qc = useQueryClient();
  const [adjustTarget, setAdjustTarget] = useState<LocationStock | null>(null);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<StockDetail>({
    queryKey: ['stock-detail', itemId],
    queryFn: async () => {
      const res = await getStockItem(itemId);
      return res as StockDetail;
    },
  });

  const adjustMutation = useMutation({
    mutationFn: async ({
      locationId,
      input,
    }: {
      locationId: string;
      input: AdjustSubmitInput;
    }) => {
      if (DEMO_MODE) {
        // simulate
        await new Promise((r) => setTimeout(r, 250));
        return { ok: true };
      }
      const params = input.force ? '?force=true' : '';
      const res = await api.post(`/stock/${itemId}/adjust${params}`, {
        location_id: locationId,
        delta: input.delta,
        reason: input.reason,
        note: input.note,
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-detail', itemId] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['movements'] });
      setAdjustTarget(null);
      setAdjustError(null);
      toastBus.push('success', 'Voorraad-mutatie geboekt');
    },
    onError: (err) => {
      const e = asApiError(err);
      const detail =
        e.details && typeof e.details === 'object' && 'message' in e.details
          ? String((e.details as { message: string }).message)
          : null;
      setAdjustError(detail ?? e.message ?? 'Onbekende fout');
    },
  });

  if (isLoading) {
    return (
      <div>
        <Skeleton width={140} height={14} />
        <div style={{ marginTop: 12 }}>
          <Skeleton width="40%" height={32} />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            marginTop: 24,
          }}
        >
          <Skeleton height={90} />
          <Skeleton height={90} />
          <Skeleton height={90} />
          <Skeleton height={90} />
        </div>
      </div>
    );
  }

  if (error) {
    const e = asApiError(error);
    return (
      <div>
        <BackLink />
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text" style={{ margin: 0 }}>
            {e.status === 404 ? 'Item niet gevonden.' : `Fout: ${e.message}`}
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div>
      <BackLink />

      <header className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{data.product?.title ?? data.sku}</h1>
            {data.product?.status && (
              <span className="badge badge-accent" style={{ textTransform: 'capitalize' }}>
                {data.product.status}
              </span>
            )}
          </div>
          <p className="page-subtitle" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span>SKU: <code className="mono">{data.sku}</code></span>
            {data.variant?.sku && data.variant.sku !== data.sku && (
              <span>Variant: <code className="mono">{data.variant.sku}</code></span>
            )}
            {data.gtin && <span>GTIN: <code className="mono">{data.gtin}</code></span>}
          </p>
        </div>
        {data.product?.id && (
          <Link
            to="/products/$id"
            params={{ id: data.product.id }}
            className="btn btn-secondary btn-sm"
          >
            <Package size={13} />
            Open product
          </Link>
        )}
      </header>

      {/* Totals */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 28,
        }}
      >
        <KpiCard label="On hand" value={data.totals.onHand} size="sm" />
        <KpiCard
          label="Available"
          value={data.totals.available}
          size="sm"
          hint={data.totals.available <= 0 ? 'Out of stock' : undefined}
        />
        <KpiCard label="Committed" value={data.totals.committed} size="sm" />
        <KpiCard label="Incoming" value={data.totals.incoming} size="sm" />
      </section>

      {/* Per-location */}
      <h2 className="card-title" style={{ marginBottom: 12 }}>Per locatie</h2>
      {data.locations.length === 0 ? (
        <div className="empty-state" style={{ padding: 24, marginBottom: 28 }}>
          <p className="muted">
            Nog geen voorraad op enige locatie. Doe een eerste adjust om voorraad
            in te boeken.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12,
            marginBottom: 28,
          }}
        >
          {data.locations.map((l) => (
            <LocationStockCard
              key={l.locationId}
              level={l}
              onAdjust={(level) => {
                setAdjustError(null);
                setAdjustTarget(level);
              }}
            />
          ))}
        </div>
      )}

      {/* Recent movements */}
      <h2 className="card-title" style={{ marginBottom: 12 }}>Recente mutaties</h2>
      <MovementsTable
        rows={data.recentMovements}
        showItem={false}
        emptyMessage="Nog geen mutaties voor dit item."
      />

      {/* Adjust modal */}
      {adjustTarget && (
        <StockAdjustModal
          open={!!adjustTarget}
          locationName={adjustTarget.name}
          locationId={adjustTarget.locationId}
          currentOnHand={adjustTarget.onHand}
          currentAvailable={adjustTarget.available}
          itemSku={data.sku}
          pending={adjustMutation.isPending}
          errorMessage={adjustError}
          onClose={() => {
            setAdjustTarget(null);
            setAdjustError(null);
          }}
          onSubmit={async (input) => {
            await adjustMutation.mutateAsync({
              locationId: adjustTarget.locationId,
              input,
            });
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/stock"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: 'var(--theme-muted)',
        fontSize: 12.5,
        textDecoration: 'none',
        marginBottom: 12,
      }}
    >
      <ArrowLeft size={13} /> Voorraad
    </Link>
  );
}
