/**
 * Storefront-tags generator — bouwt de JavaScript die ÉÉN scripttag in de
 * storefront alle client-side marketing-tags laat laden:
 *
 *   <script async src="https://<cms>/api/feeds/public/<shopId>/tags.js"></script>
 *
 * Het script leest GEEN extra config op runtime — alle ids zijn op build-moment
 * (server-side) ingebakken uit `storefront_analytics`. Zo werkt de koppeling met
 * exact één regel HTML in de storefront, en hoeft de storefront zelf niks van
 * GA4/Pixel/Clarity te weten.
 *
 * Ondersteunde tags (alleen voor ingevulde ids):
 *   - Google Analytics 4 (gtag.js) + Google Ads (gedeelde gtag) + optionele
 *     conversie-helper `window.shopTrackPurchase(value, currency, txId)`
 *   - Meta/Facebook Pixel (fbq + PageView)
 *   - Microsoft Clarity (clarity.ms/tag/<projectId>)
 *   - Vrije custom-head-HTML (rauw geïnjecteerd, met <script>-re-execute)
 *
 * VEILIGHEID: alle waarden worden via `JSON.stringify` in JS-string-literals
 * gezet (geen string-concatenatie van rauwe ids), zodat een id nooit uit zijn
 * literal kan breken. customHeadHtml is operator-eigen verantwoordelijkheid (net
 * als in de bestaande analytics-config) en wordt bewust rauw geïnjecteerd.
 *
 * PURE + TESTBAAR: deze functie raakt geen DB en geen Date — de route levert de
 * (al via toPublicAnalyticsDto enabled-gegate) input aan. Bij `enabled:false`
 * geeft het een no-op-script terug zodat de storefront niets laadt.
 */

/**
 * Structureel compatibel met `PublicAnalyticsDto` (routes/feeds/_serialize) zodat
 * de route de gegate DTO 1-op-1 kan doorgeven zonder import-koppeling.
 */
export interface StorefrontTagsInput {
  enabled: boolean;
  ga4MeasurementId: string | null;
  metaPixelId: string | null;
  googleAdsId: string | null;
  googleAdsConversionLabel: string | null;
  clarityProjectId: string | null;
  customHeadHtml: string | null;
}

/** Genereer de tags.js-body. Geeft ALTIJD geldige JavaScript terug. */
export function renderStorefrontTagsJs(input: StorefrontTagsInput): string {
  if (!input.enabled) {
    return '/* storefront-tags: tracking is disabled for this shop */\n';
  }

  const ga4 = nz(input.ga4MeasurementId);
  const ads = nz(input.googleAdsId);
  const adsLabel = nz(input.googleAdsConversionLabel);
  const pixel = nz(input.metaPixelId);
  const clarity = nz(input.clarityProjectId);
  const customHead = input.customHeadHtml && input.customHeadHtml.trim().length > 0
    ? input.customHeadHtml
    : null;

  // Niets ingevuld → no-op (maar enabled), zodat de scripttag niet 404't.
  if (!ga4 && !ads && !pixel && !clarity && !customHead) {
    return '/* storefront-tags: enabled, but no tag ids configured */\n';
  }

  const L: string[] = [];
  L.push('(function () {');
  L.push('  "use strict";');
  L.push('  var d = document;');
  L.push('  var h = d.head || d.getElementsByTagName("head")[0] || d.documentElement;');
  L.push('  function load(src) { var s = d.createElement("script"); s.async = true; s.src = src; h.appendChild(s); return s; }');

  // ── Google: GA4 + Ads via gedeelde gtag.js ──
  if (ga4 || ads) {
    const firstId = (ga4 || ads) as string;
    L.push('');
    L.push('  // Google (GA4 + Ads)');
    L.push(`  load("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(${j(firstId)}));`);
    L.push('  window.dataLayer = window.dataLayer || [];');
    L.push('  function gtag() { window.dataLayer.push(arguments); }');
    L.push('  window.gtag = window.gtag || gtag;');
    L.push('  gtag("js", new Date());');
    if (ga4) L.push(`  gtag("config", ${j(ga4)});`);
    if (ads) L.push(`  gtag("config", ${j(ads)});`);
    if (ads && adsLabel) {
      // Conversie-helper voor de checkout: shopTrackPurchase(value, currency, txId)
      L.push(
        `  window.shopTrackPurchase = function (value, currency, txId) { gtag("event", "conversion", { send_to: ${j(
          `${ads}/${adsLabel}`,
        )}, value: value, currency: currency || "EUR", transaction_id: txId || "" }); };`,
      );
    }
  }

  // ── Meta/Facebook Pixel ──
  if (pixel) {
    L.push('');
    L.push('  // Meta Pixel');
    L.push(
      '  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");',
    );
    L.push(`  fbq("init", ${j(pixel)});`);
    L.push('  fbq("track", "PageView");');
  }

  // ── Microsoft Clarity ──
  if (clarity) {
    L.push('');
    L.push('  // Microsoft Clarity');
    L.push(
      `  (function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script",${j(
        clarity,
      )});`,
    );
  }

  // ── Custom head-HTML (rauw, met <script>-re-execute) ──
  if (customHead) {
    L.push('');
    L.push('  // Custom head-HTML (operator)');
    L.push(
      `  (function (html) { var tpl = d.createElement("template"); tpl.innerHTML = html; var src = tpl.content ? tpl.content.childNodes : []; var nodes = Array.prototype.slice.call(src); for (var i = 0; i < nodes.length; i++) { var node = nodes[i]; if (node.tagName === "SCRIPT") { var sc = d.createElement("script"); for (var k = 0; k < node.attributes.length; k++) { sc.setAttribute(node.attributes[k].name, node.attributes[k].value); } sc.text = node.textContent || ""; h.appendChild(sc); } else { h.appendChild(node.cloneNode(true)); } } })(${j(
        customHead,
      )});`,
    );
  }

  L.push('})();');
  L.push('');
  return L.join('\n');
}

/** Trim → null als leeg. */
function nz(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/** Veilige JS-literal van een waarde. */
function j(v: unknown): string {
  return JSON.stringify(v);
}
