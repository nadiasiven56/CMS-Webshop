import { EmptyState } from '../components/States';
import { ShopLink } from '../components/ShopLink';

export function NotFoundPage() {
  return (
    <div className="container">
      <EmptyState
        title="404 — Pagina niet gevonden"
        message="De pagina die je zoekt bestaat niet."
        action={
          <ShopLink to="/" className="btn btn-primary">
            Naar home
          </ShopLink>
        }
      />
    </div>
  );
}
