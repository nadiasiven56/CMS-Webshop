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

// 1) launcher rendert
await page.goto(base + '/launch', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.launch-card', { timeout: 8000 }).catch(() => {});
const cardCount = await page.locator('.launch-card:not(.launch-add):not(.launch-card-skel)').count();
const heading = await page.locator('.launch-head h1').textContent().catch(() => null);
const subtitle = await page.locator('.launch-head p').textContent().catch(() => null);
const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.launch-screen') || document.body).backgroundColor);
const firstName = await page.locator('.launch-card:not(.launch-add) .launch-meta b').first().textContent().catch(() => null);
const statuses = await page.locator('.launch-status').allTextContents().catch(() => []);
await page.screenshot({ path: out + '/launch-desktop.png', fullPage: true });

// 2) klik eerste winkel -> dashboard met shell
await page.locator('.launch-card:not(.launch-add)').first().click();
await page.waitForTimeout(1300);
const afterUrl = page.url();
const hasShell = await page.locator('.app-content').count();
const allShopsBtn = await page.locator('.topbar-allshops').count();
const activeShop = await page.evaluate(() => localStorage.getItem('webshop-crm.active-shop'));
await page.screenshot({ path: out + '/after-select.png', fullPage: true });

// 3) "Alle winkels" terug naar launcher
let backOk = false;
if (allShopsBtn) {
  await page.locator('.topbar-allshops').click();
  await page.waitForTimeout(800);
  backOk = page.url().includes('/launch');
}

// 4) mobiel
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(base + '/launch', { waitUntil: 'domcontentloaded' });
await m.waitForSelector('.launch-card', { timeout: 8000 }).catch(() => {});
const mOverflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
await m.screenshot({ path: out + '/launch-mobile.png', fullPage: true });

console.log(JSON.stringify({ cardCount, heading, subtitle, bg, firstName, statuses, afterUrl, hasShell, allShopsBtn, activeShop, backOk, mOverflow, errors }, null, 2));
await browser.close();
