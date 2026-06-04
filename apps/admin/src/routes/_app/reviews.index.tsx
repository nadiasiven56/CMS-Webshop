/**
 * /reviews (index) — reviews op de ECHTE API (`/api/reviews`).
 *
 * Drie blokken:
 *   1. Sources-beheer: per provider (kiyoh/trustpilot/google) een card met
 *      status, rating-gemiddelde + count, "Configureren" (drawer met creds +
 *      config + Test + "Reviews ophalen"). Add-flow.
 *   2. Rating-samenvatting: gemiddelde + count + ster-distributie uit /summary
 *      (optioneel gefilterd op de geselecteerde source).
 *   3. Recente reviews: lijst met sterren, auteur, titel, body, datum
 *      (per geselecteerde source).
 *
 * UX/look spiegelt channels.index.tsx — alleen het domein is reviews.
 *
 * NB: dit is de INDEX-route van het reviews-layout (reviews.tsx). De layout
 * rendert enkel <Outlet/>; deze index toont de inhoud op /reviews.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Plus, Settings as SettingsIcon, Star, MessageSquare,
  CheckCircle2, CircleDashed, ServerCrash,
} from 'lucide-react';
import { SourceStatusPill } from '@/components/reviews/SourceStatusPill';
import { SourceConfigDrawer } from '@/components/reviews/SourceConfigDrawer';
import { Stars } from '@/components/reviews/Stars';
import {
  useReviewSources,
  useCreateSource,
  useReviewSummary,
  useSourceReviews,
  providerMeta,
  type ReviewSourceDto,
  type ReviewProvider,
  type ReviewDto,
} from '@/components/reviews/api';
import { formatRelative, formatNumber, formatDate } from '@/lib/format';
import { asApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard, SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';

export const Route = createFileRoute('/_app/reviews/')({
  component: ReviewsPage,
});

function ReviewsPage() {
  const query = useReviewSources();
  const [config, setConfig] = useState<ReviewSourceDto | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>(undefined);

  const sources = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  // Houd de geopende drawer-source in sync met verse data na invalidatie.
  useEffect(() => {
    if (!config) return;
    const fresh = sources.find((s) => s.id === config.id);
    if (fresh && fresh !== config) setConfig(fresh);
  }, [sources]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default-selectie voor samenvatting/reviews-lijst: eerste source met reviews,
  // anders de eerste source.
  useEffect(() => {
    if (selectedSourceId && sources.some((s) => s.id === selectedSourceId)) return;
    const first = sources[0];
    if (!first) {
      setSelectedSourceId(undefined);
      return;
    }
    const withReviews = sources.find((s) => s.ratingCount > 0);
    setSelectedSourceId((withReviews ?? first).id);
  }, [sources, selectedSourceId]);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">Reviews</h1>
            <span className="count-badge">{total}</span>
          </div>
          <p className="page-subtitle">
            Review-providers koppelen en beoordelingen ophalen — Kiyoh, Trustpilot, Google.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
            <Plus size={15} strokeWidth={2.2} />
            Provider koppelen
          </button>
        </div>
      </div>

      {query.isError ? (
        <div className="card" style={{ borderColor: 'var(--theme-danger)' }}>
          <p className="error-text">
            Kon review-providers niet laden. Controleer of de backend draait en probeer pagina-refresh.
          </p>
        </div>
      ) : query.isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} height={220} />
          ))}
        </div>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={Star}
          title="Nog geen review-providers"
          description="Koppel een provider — Kiyoh, Trustpilot of Google — om beoordelingen op te halen en te tonen."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> Provider koppelen
            </button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
          {sources.map((s) => (
            <SourceCard
              key={s.id}
              source={s}
              selected={s.id === selectedSourceId}
              onConfigure={() => setConfig(s)}
              onSelect={() => setSelectedSourceId(s.id)}
            />
          ))}

          {/* Add new card */}
          <button
            type="button"
            className="card"
            onClick={() => setAddOpen(true)}
            style={{
              border: '1px dashed var(--border-default)',
              background: 'transparent',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              minHeight: 220, cursor: 'pointer', color: 'var(--theme-muted)',
              padding: 24,
            }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: 'var(--surface-3)', border: '1px solid var(--border-default)',
              display: 'grid', placeItems: 'center', marginBottom: 12,
              color: 'var(--theme-accent)',
            }}>
              <Plus size={20} strokeWidth={2.4} />
            </div>
            <div style={{ fontWeight: 600, color: 'var(--theme-text)', marginBottom: 4 }}>
              Koppel provider
            </div>
            <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 240 }}>
              Connect Kiyoh, Trustpilot of Google Reviews.
            </div>
          </button>
        </div>
      )}

      {/* Samenvatting + recente reviews (per geselecteerde source) */}
      {sources.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)',
            gap: 16,
            marginTop: 28,
            alignItems: 'start',
          }}
          className="reviews-detail-grid"
        >
          <SummaryCard sourceId={selectedSourceId} />
          <RecentReviews sourceId={selectedSourceId} />
        </div>
      )}

      <SourceConfigDrawer source={config} onClose={() => setConfig(null)} />
      <AddSourceModal open={addOpen} onClose={() => setAddOpen(false)} />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
        @media (max-width: 860px) {
          .reviews-detail-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function SourceCard({
  source,
  selected,
  onConfigure,
  onSelect,
}: {
  source: ReviewSourceDto;
  selected: boolean;
  onConfigure: () => void;
  onSelect: () => void;
}) {
  const meta = providerMeta(source.provider);
  const hasUsableCredentials =
    source.hasCredentials && Object.keys(source.credentials ?? {}).length > 0;
  const needsCredentials = !hasUsableCredentials;
  const avg = source.ratingAverage != null ? Number(source.ratingAverage) : null;

  return (
    <div
      className="card"
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderColor: selected ? 'var(--theme-accent-border)' : undefined,
        boxShadow: selected ? '0 0 0 1px var(--theme-accent-border)' : undefined,
      }}
    >
      <div
        style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(circle at top right, ${meta.accent}10, transparent 60%)`,
          pointerEvents: 'none',
        }}
      />
      <div className="card-header" style={{ alignItems: 'flex-start', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 46, height: 46, borderRadius: 11,
              background: meta.accent,
              display: 'grid', placeItems: 'center',
              color: '#fff', fontWeight: 800, fontSize: 20,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              flexShrink: 0,
            }}
          >
            {meta.letter}
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 className="card-title" style={{ marginBottom: 3 }}>{source.name}</h2>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>{meta.kind}</span>
              <SourceStatusPill status={source.status} />
            </div>
          </div>
        </div>
        <StatusIcon status={source.status} />
      </div>

      {/* Rating-blok */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
        padding: '10px 12px', background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)', borderRadius: 8, position: 'relative',
      }}>
        <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {avg != null ? avg.toFixed(1) : '—'}
        </div>
        <div style={{ minWidth: 0 }}>
          <Stars rating={avg} size={14} />
          <div style={{ fontSize: 11.5, color: 'var(--theme-muted)', marginTop: 3 }}>
            {formatNumber(source.ratingCount)} review(s)
            {source.lastFetchAt ? ` • ${formatRelative(source.lastFetchAt)}` : ''}
          </div>
        </div>
      </div>

      <div style={{
        fontSize: 12, lineHeight: 1.45, padding: '8px 12px',
        color: 'var(--text-soft)', marginBottom: 12, position: 'relative',
      }}>
        {needsCredentials
          ? 'Credentials vereist om te activeren — klik op Configureren.'
          : source.status === 'connected'
            ? source.lastFetchAt
              ? 'Verbonden. Open Configureren om reviews opnieuw op te halen.'
              : 'Verbonden — haal reviews op via Configureren.'
            : source.status === 'error'
              ? 'Laatste verbindingstest mislukt — controleer credentials.'
              : 'Niet verbonden.'}
      </div>

      <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={onConfigure}
        >
          <SettingsIcon size={13} /> Configureren
        </button>
        <button
          type="button"
          className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-secondary'}`}
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={onSelect}
          disabled={selected}
        >
          {selected ? 'Geselecteerd' : 'Bekijk reviews'}
        </button>
      </div>
    </div>
  );
}

function SummaryCard({ sourceId }: { sourceId: string | undefined }) {
  const query = useReviewSummary(sourceId);
  const data = query.data;
  const dist = data?.distribution ?? { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  const maxCount = Math.max(1, ...Object.values(dist));

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Star size={15} style={{ color: 'var(--theme-accent)' }} />
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Rating-samenvatting</h2>
      </div>

      {query.isLoading ? (
        <SkeletonRows rows={5} height={16} />
      ) : query.isError ? (
        <p className="error-text">Kon samenvatting niet laden.</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {data?.average != null ? data.average.toFixed(1) : '—'}
            </div>
            <div>
              <Stars rating={data?.average ?? null} size={16} />
              <div style={{ fontSize: 12, color: 'var(--theme-muted)', marginTop: 4 }}>
                {formatNumber(data?.count ?? 0)} review(s)
                {data && data.rated !== data.count ? ` • ${formatNumber(data.rated)} beoordeeld` : ''}
              </div>
            </div>
          </div>

          {/* Distributie 5→1 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {[5, 4, 3, 2, 1].map((star) => {
              const count = dist[String(star)] ?? 0;
              const pct = (count / maxCount) * 100;
              return (
                <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--theme-muted)', width: 28, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {star}<Star size={10} style={{ color: '#f5a623', fill: '#f5a623' }} />
                  </span>
                  <div style={{
                    flex: 1, height: 8, borderRadius: 999,
                    background: 'var(--surface-2)', overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: '#f5a623', borderRadius: 999,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--text-soft)', width: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function RecentReviews({ sourceId }: { sourceId: string | undefined }) {
  const query = useSourceReviews(sourceId, 20);
  const reviews = query.data?.items ?? [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <MessageSquare size={15} style={{ color: 'var(--theme-accent)' }} />
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Recente reviews</h2>
        <span className="count-badge">{query.data?.total ?? 0}</span>
      </div>

      {query.isLoading ? (
        <SkeletonRows rows={4} height={56} />
      ) : query.isError ? (
        <div className="card"><p className="error-text">Kon reviews niet laden.</p></div>
      ) : reviews.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Nog geen reviews"
          description="Haal reviews op via Configureren → 'Reviews ophalen' om ze hier te tonen."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reviews.map((r) => (
            <ReviewItem key={r.id} review={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewItem({ review }: { review: ReviewDto }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: review.title || review.body ? 8 : 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Stars rating={review.rating} size={13} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {review.authorName || 'Anoniem'}
            </span>
          </div>
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--theme-muted)', flexShrink: 0 }}>
          {review.publishedAt ? formatDate(review.publishedAt) : formatDate(review.createdAt)}
        </span>
      </div>
      {review.title && (
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--theme-text)', marginBottom: 3 }}>
          {review.title}
        </div>
      )}
      {review.body && (
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-soft)' }}>
          {review.body}
        </p>
      )}
    </div>
  );
}

function AddSourceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const allProviders: ReviewProvider[] = ['kiyoh', 'trustpilot', 'google'];

  const [provider, setProvider] = useState<ReviewProvider>('kiyoh');
  const [name, setName] = useState(providerMeta('kiyoh').label);
  const create = useCreateSource();

  useEffect(() => {
    if (open) {
      setProvider('kiyoh');
      setName(providerMeta('kiyoh').label);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const finalName = name.trim() || providerMeta(provider).label;
    try {
      await create.mutateAsync({ provider, name: finalName });
      toast.success(
        `Provider ${finalName} gekoppeld — niet-verbonden. Configureer & activeer.`,
      );
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Koppelen mislukt: ${e2.message}`);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Review-provider koppelen"
      subtitle="Selecteer een provider en geef een naam op."
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleer</button>
          <button type="submit" form="add-source-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Koppelen…' : 'Provider koppelen'}
          </button>
        </>
      }
    >
      <form id="add-source-form" onSubmit={onSubmit}>
        <FormField label="Provider">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {allProviders.map((k) => {
              const v = providerMeta(k);
              return (
              <button
                key={k}
                type="button"
                onClick={() => { setProvider(k); setName(v.label); }}
                style={{
                  padding: '12px 10px',
                  background: provider === k ? 'var(--theme-accent-subtle)' : 'var(--surface-2)',
                  border: provider === k ? '1px solid var(--theme-accent-border)' : '1px solid var(--border-default)',
                  borderRadius: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: v.accent, color: '#fff',
                  display: 'grid', placeItems: 'center',
                  fontWeight: 700, fontSize: 12,
                }}>{v.letter}</div>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{v.label}</span>
              </button>
              );
            })}
          </div>
        </FormField>
        <FormField label="Naam" required>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder={providerMeta(provider).label} />
        </FormField>
        <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-soft)', lineHeight: 1.5 }}>
          De provider wordt gekoppeld als <strong>niet-verbonden</strong>. Klik daarna op
          "Configureren" om credentials + config in te voeren en reviews op te halen.
        </div>
      </form>
    </Modal>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'connected') return <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />;
  if (status === 'error') return <ServerCrash size={18} style={{ color: 'var(--danger)' }} />;
  return <CircleDashed size={18} style={{ color: 'var(--theme-muted)' }} />;
}
