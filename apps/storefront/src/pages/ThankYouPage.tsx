import { useSearchParams } from 'react-router-dom';
import { ShopLink } from '../components/ShopLink';
import { useShop } from '../state/ShopProvider';

export function ThankYouPage() {
  const [params] = useSearchParams();
  const orderNumber = params.get('order');
  const { shop } = useShop();

  return (
    <div className="container">
      <div className="state" style={{ paddingTop: 80 }}>
        <div
          style={{
            fontSize: 56,
            marginBottom: 8,
          }}
          aria-hidden
        >
          ✅
        </div>
        <h1>Bedankt voor je bestelling!</h1>
        {orderNumber ? (
          <p>
            Je bestelnummer is{' '}
            <strong style={{ color: 'var(--brand-primary)' }}>
              {orderNumber}
            </strong>
            . Je ontvangt een bevestiging per e-mail.
          </p>
        ) : (
          <p>Je bestelling is geplaatst.</p>
        )}
        {shop?.supportEmail && (
          <p className="product-card__vendor">
            Vragen? Mail ons op{' '}
            <a href={`mailto:${shop.supportEmail}`}>{shop.supportEmail}</a>
          </p>
        )}
        <ShopLink
          to="/shop"
          className="btn btn-primary btn-lg"
          style={{ marginTop: 16 }}
        >
          Verder winkelen
        </ShopLink>
      </div>
    </div>
  );
}
