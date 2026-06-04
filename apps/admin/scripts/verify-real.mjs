import { chromium } from '@playwright/test';
import fs from 'fs';

const base = 'http://127.0.0.1:7301';
const out = 'C:/temp/launch-qa';
fs.mkdirSync(out, { recursive: true });

const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

// 1) Login (echte api, non-demo)
await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'admin@webshop-crm.local');
await page.fill('#password', 'admin12345');
await page.click('button[type=submit]');
await page.waitForURL('**/launch', { timeout: 10000 }).catch(() => {});
await page.waitForSelector('.launch-card:not(.launch-add)', { timeout: 10000 }).catch(() => {});

// 2) Launcher met ECHTE shops
const landedOn = page.url();
const cardCount = await page.locator('.launch-card:not(.launch-add):not(.launch-card-skel)').count();
const names = await page.locator('.launch-card:not(.launch-add) .launch-meta b').allTextContents().catch(() => []);
const domains = await page.locator('.launch-card:not(.launch-add) .launch-meta small').allTextContents().catch(() => []);
await page.screenshot({ path: out + '/real-launcher.png', fullPage: true });

// 3) Klik eerste winkel -> dashboard met echte data
const errBeforeDash = errors.length;
await page.locator('.launch-card:not(.launch-add)').first().click();
await page.waitForTimeout(1500);
const afterUrl = page.url();
const activeShop = await page.evaluate(() => localStorage.getItem('webshop-crm.active-shop'));
const errOnDash = errors.length - errBeforeDash;
await page.screenshot({ path: out + '/real-dashboard.png', fullPage: true });

console.log(JSON.stringify({
  landedOn, cardCount, names, domains, afterUrl, activeShop,
  errCountTotal: errors.length, errDuringDashboard: errOnDash,
  errors: errors.slice(0, 12),
}, null, 2));
await browser.close();
