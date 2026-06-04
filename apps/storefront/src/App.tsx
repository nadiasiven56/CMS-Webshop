import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ShopProvider } from './state/ShopProvider';
import { CartProvider } from './state/CartProvider';
import { ToastProvider } from './state/ToastProvider';
import { HomePage } from './pages/HomePage';
import { CatalogPage } from './pages/CatalogPage';
import { ProductPage } from './pages/ProductPage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { ThankYouPage } from './pages/ThankYouPage';
import { ContentPage } from './pages/ContentPage';
import { BlogListPage } from './pages/BlogListPage';
import { BlogPostPage } from './pages/BlogPostPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Provider-volgorde:
 *   Shop (branding + active shop)  →  Cart (token, per shop)  →  Toast
 * Router daarbinnen zodat alle pagina's de context delen.
 */
export function App() {
  return (
    <BrowserRouter>
      <ShopProvider>
        <CartProvider>
          <ToastProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/shop" element={<CatalogPage />} />
                <Route path="/product/:slug" element={<ProductPage />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/checkout" element={<CheckoutPage />} />
                <Route path="/bedankt" element={<ThankYouPage />} />
                <Route path="/pagina/:slug" element={<ContentPage />} />
                <Route path="/blog" element={<BlogListPage />} />
                <Route path="/blog/:slug" element={<BlogPostPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </ToastProvider>
        </CartProvider>
      </ShopProvider>
    </BrowserRouter>
  );
}
