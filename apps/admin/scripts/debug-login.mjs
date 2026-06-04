import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors = [];
const apiResp = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.url().includes('/api/')) apiResp.push(r.status() + ' ' + r.request().method() + ' ' + r.url().replace('http://127.0.0.1:7301', '')); });

await page.goto('http://127.0.0.1:7301/login', { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'admin@webshop-crm.local');
await page.fill('#password', 'admin12345');
await page.click('button[type=submit]');
await page.waitForTimeout(3500);

console.log('url na login:', page.url());
console.log('login error text:', await page.locator('.error-text').textContent().catch(() => '(geen)'));
console.log('launch-cards zichtbaar:', await page.locator('.launch-card').count());
console.log('body snippet:', (await page.locator('body').textContent()).replace(/\s+/g, ' ').slice(0, 280));
console.log('api responses:', apiResp);
console.log('console errors:', errors.slice(0, 8));
await browser.close();
