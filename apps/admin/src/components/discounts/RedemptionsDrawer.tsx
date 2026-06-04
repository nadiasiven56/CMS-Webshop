/**
 * RedemptionsDrawer — toon de append-only inwisselingen van één kortingscode
 * (`GET /api/discounts/:id/redemptions`). Read-only: klant-e-mail, order,
 * toegepast bedrag (Money-string) en tijd.
 */
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { formatDateTime } from '@/lib/format';
import { Ticket } from 'lucide-react';
import { useDiscountRedemptions, type DiscountDto } from './api';

export function RedemptionsDrawer({
  discount,
  onClose,
}: {
  discount: DiscountDto | null;
  onClose: () => void;
}) {
  const open = discount != null;
  const query = useDiscountRedemptions(discount?.id);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={discount ? `Inwisselingen — ${discount.code}` : 'Inwisselingen'}
      subtitle={
        discount
          ? `${total} inwisseling(en)${discount.maxRedemptions != null ? ` van max. ${discount.maxRedemptions}` : ''}`
          : undefined
      }
      width={560}
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Sluiten
        </button>
      }
    >
      {!discount ? null : query.isLoading ? (
        <SkeletonRows rows={5} />
      ) : query.isError ? (
        <p className="error-text">Kon inwisselingen niet laden.</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="Nog niet ingewisseld"
          description="Zodra een klant deze code gebruikt, verschijnt de inwisseling hier."
        />
      ) : (
        <div className="table-wrap">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Klant</th>
                  <th>Order</th>
                  <th style={{ textAlign: 'right' }}>Toegepast</th>
                  <th style={{ textAlign: 'right' }}>Wanneer</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 12.5 }}>
                      {r.customerEmail ?? <span className="muted">—</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {r.orderId ? (
                        <span className="mono" style={{ fontSize: 11.5 }}>{r.orderId.slice(0, 8)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>
                      {r.amountApplied}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--theme-muted)' }}>
                      {formatDateTime(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}
