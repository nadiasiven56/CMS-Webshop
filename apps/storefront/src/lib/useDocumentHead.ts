/**
 * Mini SEO-hook zonder externe lib. Zet — via de DOM — document.title, de
 * meta-description, canonical, en een set Open-Graph-tags, plus optioneel een
 * JSON-LD <script>. Alles wordt bij unmount/route-wissel netjes opgeruimd of
 * teruggezet, zodat pagina's elkaars head niet vervuilen.
 *
 * Bewust geen react-helmet o.i.d.: één bestand, geen dependency, SSR-veilig
 * (no-op buiten de browser).
 */
import { useEffect } from 'react';

export interface DocumentHead {
  /** Volledige document.title (bv. "Productnaam — Shop"). */
  title?: string;
  /** meta[name=description]. */
  description?: string;
  /** Canonical URL; default = de huidige href zonder query/hash. */
  canonical?: string;
  /** og:type (default 'website'). */
  ogType?: string;
  /** og:image absolute URL. */
  image?: string;
  /** JSON-LD object(en) die als <script type="application/ld+json"> komen. */
  jsonLd?: object | object[] | null;
}

/** Marker zodat we alleen onze eigen, dynamisch gezette tags opruimen. */
const MANAGED = 'data-storefront-head';

function setMeta(
  selector: string,
  attr: 'name' | 'property',
  key: string,
  content: string | undefined,
  created: Element[],
): void {
  if (!content) return;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    el.setAttribute(MANAGED, '');
    document.head.appendChild(el);
    created.push(el);
  }
  el.setAttribute('content', content);
}

function defaultCanonical(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}`;
}

export function useDocumentHead(head: DocumentHead): void {
  const { title, description, canonical, ogType, image, jsonLd } = head;

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const prevTitle = document.title;
    const created: Element[] = [];

    if (title) document.title = title;

    // ── meta description ──
    setMeta(
      'meta[name="description"]',
      'name',
      'description',
      description,
      created,
    );

    // ── canonical ──
    const canonicalHref = canonical ?? defaultCanonical();
    let canonicalEl = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    let canonicalCreated = false;
    if (canonicalHref) {
      if (!canonicalEl) {
        canonicalEl = document.createElement('link');
        canonicalEl.rel = 'canonical';
        canonicalEl.setAttribute(MANAGED, '');
        document.head.appendChild(canonicalEl);
        canonicalCreated = true;
      }
      canonicalEl.href = canonicalHref;
    }

    // ── Open Graph ──
    setMeta('meta[property="og:title"]', 'property', 'og:title', title, created);
    setMeta(
      'meta[property="og:description"]',
      'property',
      'og:description',
      description,
      created,
    );
    setMeta(
      'meta[property="og:type"]',
      'property',
      'og:type',
      ogType ?? 'website',
      created,
    );
    setMeta(
      'meta[property="og:url"]',
      'property',
      'og:url',
      canonicalHref || undefined,
      created,
    );
    setMeta('meta[property="og:image"]', 'property', 'og:image', image, created);

    // ── JSON-LD ──
    let ldScript: HTMLScriptElement | null = null;
    if (jsonLd) {
      ldScript = document.createElement('script');
      ldScript.type = 'application/ld+json';
      ldScript.setAttribute(MANAGED, '');
      try {
        ldScript.textContent = JSON.stringify(jsonLd);
        document.head.appendChild(ldScript);
      } catch {
        ldScript = null;
      }
    }

    return () => {
      document.title = prevTitle;
      for (const el of created) el.remove();
      if (canonicalCreated && canonicalEl) canonicalEl.remove();
      if (ldScript) ldScript.remove();
    };
  }, [title, description, canonical, ogType, image, jsonLd]);
}
