import { ShopLink } from './ShopLink';
import { useShop } from '../state/ShopProvider';

export function Footer() {
  const { shop } = useShop();
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-cols">
          <div>
            <h4>{shop?.name ?? 'Webshop'}</h4>
            <p style={{ margin: 0, maxWidth: 320 }}>
              {shop?.slug === 'pawfect'
                ? 'Gezonde voeding en verzorging voor je trouwe viervoeter.'
                : 'Versgebrande koffie, machines en accessoires voor de echte liefhebber.'}
            </p>
            {shop?.supportEmail && (
              <p style={{ marginTop: 12 }}>
                <a href={`mailto:${shop.supportEmail}`}>{shop.supportEmail}</a>
              </p>
            )}
          </div>
          <div>
            <h4>Shop</h4>
            <ShopLink to="/shop">Alle producten</ShopLink>
            <ShopLink to="/cart">Winkelwagen</ShopLink>
            <ShopLink to="/blog">Blog</ShopLink>
          </div>
          <div>
            <h4>Info</h4>
            <ShopLink to="/pagina/over-ons">Over ons</ShopLink>
            {shop?.supportEmail && (
              <a href={`mailto:${shop.supportEmail}`}>Klantenservice</a>
            )}
          </div>
        </div>
        <div className="footer-bottom">
          © {year} {shop?.name ?? 'Webshop'} · Aangedreven door het Webshop-CRM
          platform
        </div>
      </div>
    </footer>
  );
}
