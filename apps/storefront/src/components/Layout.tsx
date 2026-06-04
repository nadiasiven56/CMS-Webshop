import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { useShop } from '../state/ShopProvider';
import { Spinner, ErrorState } from './States';

export function Layout() {
  const { loading, error } = useShop();
  const location = useLocation();

  // scroll naar boven bij route-wissel
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="container">
        <Spinner label="Shop laden…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="container">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <>
      <Header />
      <main>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
