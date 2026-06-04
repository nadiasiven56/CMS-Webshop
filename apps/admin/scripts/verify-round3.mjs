import { chromium } from '@playwright/test';
import fs from 'fs';

const base = 'http://127.0.0.1:7301';
const out = 'C:/temp/round3-qa';
fs.mkdirSync(out, { recursive: true });

// [name, path, expectedHeading]
const pages = [
  ['shipping', '/shipping', 'Verzending'],
  ['reviews', '/reviews', 'Reviews'],
  ['accounting', '/accounting', 'Boekhouding'],
  ['accounting-koppelingen', '/accounting/koppelingen', 'Boekhoud-koppeling'],
  ['notifications', '/notifications', 'E-mail'],
  ['discounts', '/discounts', 'Kortingen'],
  ['marketing', '/marketing', 'Marketing'],
  ['analytics', '/analytics', 'Statistieken'],
  ['webhooks', '/webhooks', 'Webhook-log'],
  ['audit-log', '/audit-log', 'Audit-log'],
];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();

let ce = [], pe = [], ae = [];
p.on('console', (m) => { if (m.type() === 'error') ce.push(m.text().slice(0, 220)); });
p.on('pageerror', (e) => pe.push('PAGEERR: ' + e.message.slice(0, 220)));
p.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/') && r.status() >= 400) ae.push(`${r.status()} ${u.replace('http://127.0.0.1:7300', '').replace(base, '')}`);
});

// --- login + pick first shop (boilerplate mirrored from verify-waveD.mjs) ---
await p.goto(base + '/login', { waitUntil: 'domcontentloaded' });
await p.fill('#email', 'admin@webshop-crm.local');
await p.fill('#password', 'admin12345');
await p.click('button[type=submit]');
await p.waitForURL('**/launch', { timeout: 10000 }).catch(() => {});
await p.waitForSelector('.launch-card:not(.launch-add)', { timeout: 10000 }).catch(() => {});
await p.locator('.launch-card:not(.launch-add)').first().click().catch(() => {});
await p.waitForTimeout(1400);

const rep = [];
for (const [name, path, expectedHeading] of pages) {
  ce = []; pe = []; ae = [];
  await p.goto(base + path, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);

  const txt = await p.locator('body').innerText().catch(() => '');
  const headingText = await p.locator('h1.page-title').first().innerText().catch(() => '');
  const inputCount = await p.locator('input, select, textarea').count().catch(() => 0);
  const buttonCount = await p.locator('button').count().catch(() => 0);
  const looksErr = await p
    .locator('text=/Something went wrong|Cannot read|undefined is not|is not a function|TypeError/i')
    .count()
    .catch(() => 0);

  await p.screenshot({ path: `${out}/${name}.png`, fullPage: true }).catch(() => {});

  const errors = [];
  if (pe.length) errors.push(...pe.slice(0, 3));
  if (ae.length) errors.push(...ae.slice(0, 6).map((x) => 'API ' + x));
  if (looksErr > 0) errors.push('error-text-on-page');
  if (txt.length <= 400) errors.push('blank/too-little-content (' + txt.length + ' chars)');
  // list-bug: heading should be this page's own heading
  if (headingText.trim() !== expectedHeading) {
    errors.push(`LIST-BUG? heading="${headingText.trim()}" expected="${expectedHeading}"`);
  }
  // console errors are informational; include but don't auto-fail unless they look like crashes
  const consoleCrash = ce.filter((m) => /TypeError|ReferenceError|is not a function|Cannot read|undefined is not/i.test(m));
  if (consoleCrash.length) errors.push(...consoleCrash.slice(0, 3).map((x) => 'CONSOLE ' + x));

  rep.push({
    route: path,
    headingText: headingText.trim(),
    ok: errors.length === 0,
    chars: txt.length,
    inputs: inputCount,
    buttons: buttonCount,
    consoleErrors: ce.slice(0, 4),
    errors,
  });
}

console.log('ROUND3_RESULT_JSON_START');
console.log(JSON.stringify(rep, null, 2));
console.log('ROUND3_RESULT_JSON_END');
await b.close();
