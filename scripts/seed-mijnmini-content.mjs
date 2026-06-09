/**
 * Vult de MijnMini-shop met echte CMS-content:
 *   - pagina-blocks (richtext) voor de 9 bestaande pagina's
 *   - menu-items (header + footer, bulk-replace)
 *   - blog-bodies + excerpts + publishedAt
 *
 * Gebruik:  node scripts/seed-mijnmini-content.mjs
 */
const API = process.env.CMS_API_URL || 'https://cms-api-production-9f7b.up.railway.app';
const EMAIL = process.env.CMS_EMAIL || 'info@mijnmini.com';
const PASSWORD = process.env.CMS_PASSWORD || 'MijnMini2026!';

let cookie = '';

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leeg */ }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

const rt = (html) => [{ id: crypto.randomUUID(), type: 'richtext', data: { html } }];

const PAGE_CONTENT = {
  retourbeleid: '<h2>Retourbeleid MijnMini</h2><p>Bij MijnMini heb je <strong>14 dagen bedenktijd</strong> na ontvangst van je bestelling.</p><h3>Voorwaarden</h3><ul><li>Product in originele staat</li><li>Originele verpakking intact</li><li>Product niet beschadigd of gebruikt</li></ul><h3>Hoe retourneer je?</h3><ol><li>Mail naar info@mijnmini.com met je ordernummer</li><li>Wacht op bevestiging met retourinstructies</li><li>Verpak het product en stuur het terug</li></ol><h3>Terugbetaling</h3><p>Binnen 14 werkdagen na ontvangst van de retour wordt het bedrag teruggestort.</p>',
  verzendinfo: '<h2>Verzending &amp; Levering</h2><p><strong>Gratis verzending</strong> op alle bestellingen.</p><p>Levering binnen <strong>1 tot 3 werkdagen</strong> via PostNL.</p><p>Na verzending ontvang je een <strong>Track &amp; Trace code</strong> per e-mail.</p><p>Niet thuis? Dan wordt je pakket bij de buren of een PostNL-afhaalpunt bezorgd.</p>',
  privacybeleid: '<h2>Privacybeleid</h2><p>MijnMini respecteert je privacy. Wij verzamelen alleen gegevens die noodzakelijk zijn voor het verwerken van bestellingen en de nieuwsbrief.</p><p>Wij plaatsen <strong>geen tracking- of advertentiecookies</strong>. Je gegevens worden niet gedeeld met derden.</p><p>Vragen? Mail naar info@mijnmini.com.</p>',
  'algemene-voorwaarden': '<h2>Algemene Voorwaarden</h2><p>Alle prijzen zijn inclusief BTW. Levering binnen 1-3 werkdagen. 14 dagen bedenktijd. 1 jaar garantie op alle producten.</p><p>Betaling via iDEAL, Visa, Mastercard, PayPal of Klarna.</p><p>Door een bestelling te plaatsen ga je akkoord met deze voorwaarden.</p>',
  garantie: '<h2>Garantie</h2><p>Op alle producten geldt <strong>1 jaar garantie</strong>.</p><p>Defect binnen de garantieperiode? Mail naar info@mijnmini.com met je ordernummer en een foto, dan lossen we het snel op.</p>',
  'ons-verhaal': '<h2>Ons Verhaal</h2><p>MijnMini is geboren uit de wens om ouders te helpen bij het vinden van de beste producten voor hun kleintje.</p><p>Wij selecteren alleen producten waar we 100% achter staan. Veiligheid, comfort en kwaliteit staan voorop.</p>',
  'veelgestelde-vragen': '<h2>Veelgestelde Vragen</h2><p><strong>Wat zijn de verzendkosten?</strong><br/>Verzending is gratis op alle bestellingen.</p><p><strong>Wat is de levertijd?</strong><br/>1 tot 3 werkdagen via PostNL.</p><p><strong>Kan ik retourneren?</strong><br/>Ja, je hebt 14 dagen bedenktijd. Het product moet ongebruikt en origineel verpakt zijn.</p><p><strong>Welke betaalmethoden zijn er?</strong><br/>iDEAL, Visa, Mastercard, PayPal en Klarna.</p><p><strong>Hoeveel garantie krijg ik?</strong><br/>1 jaar op alle producten.</p><p><strong>Hoe neem ik contact op?</strong><br/>Via info@mijnmini.com of WhatsApp +31 6 29292750.</p>',
  duurzaamheid: '<h2>Duurzaamheid</h2><p>Wij gebruiken gerecyclede verpakkingen en geen plastic opvulmateriaal.</p><p>We geven de voorkeur aan duurzaam geproduceerde producten en meegroei-producten die jarenlang meegaan.</p>',
  vacatures: '<h2>Werken bij MijnMini</h2><p>Op dit moment hebben we geen openstaande vacatures.</p><p>Open sollicitatie? Mail naar vacatures@mijnmini.com.</p>',
};

const HEADER_ITEMS = [
  'Kinderwagens', 'Autostoelen', 'Wipstoelen', 'Eetstoelen', 'Boxen',
  'Badderen', 'Spenen', 'Aankleedkussens', 'Luiertassen', 'Sale',
].map((label, i) => ({
  label,
  url: `/producten?category=${label.toLowerCase()}`,
  position: i,
}));

const FOOTER_SERVICE_ITEMS = [
  { label: 'Contact', url: '/contact' },
  { label: 'Verzending', url: '/pagina/verzendinfo' },
  { label: 'Retourneren', url: '/pagina/retourbeleid' },
  { label: 'Veelgestelde vragen', url: '/pagina/veelgestelde-vragen' },
  { label: 'Garantie', url: '/pagina/garantie' },
  { label: 'Algemene voorwaarden', url: '/pagina/algemene-voorwaarden' },
].map((it, i) => ({ ...it, position: i }));

const FOOTER_OVER_ITEMS = [
  { label: 'Ons verhaal', url: '/pagina/ons-verhaal' },
  { label: 'Vacatures', url: '/pagina/vacatures' },
  { label: 'Blog', url: '/blog' },
  { label: 'Duurzaamheid', url: '/pagina/duurzaamheid' },
  { label: 'Privacybeleid', url: '/pagina/privacybeleid' },
].map((it, i) => ({ ...it, position: i }));

const BLOG_CONTENT = {
  babyuitzet: {
    excerpt: 'Alles wat je nodig hebt voor de komst van je kleintje, overzichtelijk op een rij.',
    bodyHtml: '<p>De komst van een baby is spannend — en de lijst met spullen lijkt eindeloos. Met deze checklist weet je zeker dat je niets vergeet.</p><h2>Onderweg</h2><ul><li>Kinderwagen of travel system</li><li>Autostoel (i-Size, vanaf geboorte)</li><li>Luiertas</li></ul><h2>Thuis</h2><ul><li>Box of speelkleed</li><li>Wipstoel</li><li>Aankleedkussen</li></ul><h2>Verzorging</h2><ul><li>Babybadje (met thermometer)</li><li>Spenen en flessen</li><li>Hydrofiele doeken</li></ul><p>Tip: koop niet alles vooraf. Een aantal zaken, zoals een eetstoel, heb je pas na een paar maanden nodig.</p>',
  },
  onderhoud: {
    excerpt: 'Met deze onderhoudstips gaan je kinderwagen, babystoel en autostoel jaren mee.',
    bodyHtml: '<p>Goede babyspullen zijn een investering. Met het juiste onderhoud gaan ze moeiteloos meerdere kinderen mee.</p><h2>Kinderwagen</h2><p>Maak de wielen maandelijks schoon en controleer de remmen. Bekleding kan meestal op 30 graden in de wasmachine.</p><h2>Autostoel</h2><p>Haal de bekleding regelmatig af en was deze volgens het waslabel. Controleer de gordels op slijtage.</p><h2>Wip- en eetstoel</h2><p>Neem kunststof onderdelen af met een vochtige doek. Gebruik geen agressieve schoonmaakmiddelen.</p>',
  },
  kinderwagen: {
    excerpt: 'Waar moet je op letten bij het kiezen van een kinderwagen? Wij zetten het op een rij.',
    bodyHtml: '<p>Een kinderwagen is een van de grootste aankopen voor je baby. Waar let je op?</p><h2>1. Gebruik</h2><p>Woon je in de stad, dan is wendbaarheid belangrijk. Wandel je veel in het bos, kies dan grote luchtbanden.</p><h2>2. Opvouwbaarheid</h2><p>Past de wagen in je kofferbak? Test het opvouwen — het liefst met één hand.</p><h2>3. Meegroeien</h2><p>Een 3-in-1 travel system (reiswieg, wandelzit en autostoel-adapter) gaat van geboorte tot peuter mee.</p><h2>4. Veiligheid</h2><p>Let op een vijfpuntsgordel en een degelijke rem.</p>',
  },
  badderen: {
    excerpt: 'Badtijd! Met deze 10 tips wordt het badderen van je mini een feestje.',
    bodyHtml: '<p>Badderen is een heerlijk moment voor jou en je baby. Met deze tips gaat het veilig en ontspannen.</p><ol><li>Zorg dat de badkamer warm is (22-24 graden).</li><li>Gebruik een badthermometer: 37 graden is ideaal.</li><li>Leg alles vooraf klaar: handdoek, luier, kleertjes.</li><li>Houd je baby altijd vast — laat nooit alleen.</li><li>Begin met korte badjes van 5-10 minuten.</li><li>Gebruik weinig of geen zeep bij een jonge baby.</li><li>Dep de huid droog, niet wrijven.</li><li>Vergeet de huidplooitjes niet.</li><li>Maak er een vast ritueel van voor het slapen.</li><li>Geniet — het gaat zo snel voorbij!</li></ol>',
  },
};

const GENERIC_BLOG = (title) => ({
  excerpt: `${title} — lees onze tips en adviezen.`,
  bodyHtml: `<p>In dit artikel delen we onze tips en adviezen rondom <strong>${title.toLowerCase()}</strong>. Heb je vragen? Neem gerust contact op via info@mijnmini.com.</p>`,
});

async function main() {
  const login = await req('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  console.log('Login OK:', login.user.email);

  const shops = await req('GET', '/api/shops');
  const shopId = shops.items[0].id;
  console.log('Shop:', shopId);

  // ── Pagina's ──
  const pages = await req('GET', `/api/cms/pages?shop=${shopId}&limit=100`);
  for (const page of pages.items) {
    const html = PAGE_CONTENT[page.slug];
    if (!html) { console.log(`  pagina ${page.slug}: geen content gedefinieerd, overgeslagen`); continue; }
    if (Array.isArray(page.blocks) && page.blocks.length > 0) {
      console.log(`  pagina ${page.slug}: heeft al ${page.blocks.length} blocks, overgeslagen`);
      continue;
    }
    await req('PATCH', `/api/cms/pages/${page.id}?shop=${shopId}`, {
      blocks: rt(html),
      status: 'published',
      publishedAt: new Date().toISOString(),
    });
    console.log(`  pagina ${page.slug}: blocks gevuld`);
  }

  // ── Menu's ──
  const menus = await req('GET', `/api/cms/menus?shop=${shopId}`);
  const byLocation = Object.fromEntries(menus.items.map((m) => [m.location, m]));

  if (byLocation.header) {
    await req('PUT', `/api/cms/menus/${byLocation.header.id}/items?shop=${shopId}`, { items: HEADER_ITEMS });
    console.log(`  menu header: ${HEADER_ITEMS.length} items gezet`);
  }
  if (byLocation.footer) {
    await req('PUT', `/api/cms/menus/${byLocation.footer.id}/items?shop=${shopId}`, { items: FOOTER_SERVICE_ITEMS });
    console.log(`  menu footer: ${FOOTER_SERVICE_ITEMS.length} items gezet`);
  }
  if (!byLocation['footer-over']) {
    const created = await req('POST', `/api/cms/menus?shop=${shopId}`, {
      shopId, location: 'footer-over', name: 'Footer Over MijnMini',
    });
    byLocation['footer-over'] = created.menu;
    console.log('  menu footer-over: aangemaakt');
  }
  await req('PUT', `/api/cms/menus/${byLocation['footer-over'].id}/items?shop=${shopId}`, { items: FOOTER_OVER_ITEMS });
  console.log(`  menu footer-over: ${FOOTER_OVER_ITEMS.length} items gezet`);

  // ── Blog ──
  const blog = await req('GET', `/api/cms/blog?shop=${shopId}&limit=100`);
  for (const post of blog.items) {
    if (post.bodyHtml && post.bodyHtml.length > 0) {
      console.log(`  blog ${post.slug}: heeft al body, overgeslagen`);
      continue;
    }
    const content = BLOG_CONTENT[post.slug] ?? GENERIC_BLOG(post.title);
    await req('PATCH', `/api/cms/blog/${post.id}?shop=${shopId}`, {
      excerpt: content.excerpt,
      bodyHtml: content.bodyHtml,
      author: 'MijnMini',
      status: 'published',
      publishedAt: new Date().toISOString(),
    });
    console.log(`  blog ${post.slug}: body gevuld`);
  }

  console.log('Klaar.');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
