import { chromium } from '@playwright/test';
import fs from 'fs';

const base = 'http://127.0.0.1:7301';
const out = 'C:/temp/waveC-qa';
fs.mkdirSync(out, { recursive: true });

const pages = [
  ['dashboard', '/'],
  ['channels', '/channels'],
  ['channels-matrix', '/channels/matrix'],
  ['locations', '/locations'],
  ['returns', '/returns'],
  ['settings-users', '/settings/users'],
  ['settings-tokens', '/settings/tokens'],
  ['settings-webhooks', '/settings/webhooks'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

let consoleErrors = [];
let pageErrors = [];
let apiErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => pageErrors.push('PAGEERROR: ' + e.message.slice(0, 200)));
page.on('response', (r) => { const u = r.url(); if (u.includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${u.replace(base, '')}`); });

// login
await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'admin@webshop-crm.local');
await page.fill('#password', 'admin12345');
await page.click('button[type=submit]');
await page.waitForURL('**/launch', { timeout: 10000 }).catch(() => {});
await page.waitForSelector('.launch-card:not(.launch-add)', { timeout: 10000 }).catch(() => {});
// pick a shop so activeShop is set
await page.locator('.launch-card:not(.launch-add)').first().click().catch(() => {});
await page.waitForTimeout(1200);

const report = [];
for (const [name, path] of pages) {
  consoleErrors = []; pageErrors = []; apiErrors = [];
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const url = page.url();
  const bodyLen = (await page.locator('body').innerText().catch(() => '')).length;
  // crash sentinel: TanStack error boundary / blank
  const looksError = await page.locator('text=/Something went wrong|Error:|errorComponent|Cannot read|undefined is not/i').count().catch(() => 0);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  report.push({
    name, url, bodyChars: bodyLen,
    rendered: bodyLen > 400 && looksError === 0,
    consoleErrors: consoleErrors.slice(0, 4),
    pageErrors: pageErrors.slice(0, 3),
    apiErrors: apiErrors.slice(0, 5),
  });
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
