// verify-admin.mjs — browser-verificatie van de admin op echte data.
// Login -> bezoek elke kern-route -> screenshot + verzamel console/page-errors.
import { mkdirSync } from 'node:fs';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('@playwright/test')); }

const BASE = 'http://127.0.0.1:7301';
const OUT = 'C:/temp/wc-admin-shots';
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ['dashboard', '/'],
  ['shops', '/shops'],
  ['cms-pages', '/cms/pages'],
  ['cms-blog', '/cms/blog'],
  ['cms-menus', '/cms/menus'],
  ['cms-media', '/cms/media'],
  ['orders', '/orders'],
  ['customers', '/customers'],
  ['finance', '/finance'],
  ['ledger', '/ledger'],
  ['accounting', '/accounting'],
  ['suppliers', '/suppliers'],
  ['purchase-orders', '/purchase-orders'],
  ['products', '/products'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errByRoute = {};
let current = 'login';
const IGNORE = [/favicon/i, /Download the React DevTools/i, /\[vite\]/i];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (IGNORE.some((r) => r.test(t))) return;
  (errByRoute[current] ??= []).push('console: ' + t.slice(0, 220));
});
page.on('pageerror', (e) => {
  (errByRoute[current] ??= []).push('pageerror: ' + String(e.message || e).slice(0, 220));
});

// ── Login ──
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'admin@webshop-crm.local');
await page.fill('#password', 'admin12345');
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
console.log('LOGIN -> url=' + page.url());

// ── Routes ──
for (const [name, route] of ROUTES) {
  current = name;
  try {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1900);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    const errs = errByRoute[name] || [];
    console.log(`${errs.length === 0 ? 'OK ' : 'XX '} ${name.padEnd(16)} (${route})  errors=${errs.length}`);
    errs.slice(0, 3).forEach((e) => console.log('      ' + e));
  } catch (e) {
    console.log(`ERR ${name} (${route}): ${String(e.message).slice(0, 160)}`);
  }
}

await browser.close();
const total = Object.values(errByRoute).flat().length;
console.log(`\nDONE  routes=${ROUTES.length}  totale-errors=${total}  shots=${OUT}`);
