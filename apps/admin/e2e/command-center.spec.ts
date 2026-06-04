import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Wave E3 — command-center END-TO-END (admin op :7301, echte API op :7300).
 *
 * Bewijst de hele keten via de UI, NA de Wave-E smoke (die de e2e-order +
 * ledger heeft aangemaakt via het publieke storefront-SDK-pad):
 *
 *   1. Login (#email/#password → /launch → klik eerste .launch-card → /).
 *   2. Dashboard (/) toont ECHTE KPI's met niet-nul omzet.
 *   3. /channels: own_webshop = "Verbonden"; bol = credentials-/error-state.
 *   4. /orders met "Alle shops" + kanaal=web: de e2e-order(s) (test-e-mail).
 *   5. /finance: geconsolideerde per-kanaal-tabel met een Webshop-rij + niet-nul totaal.
 *
 * Alle assertions draaien met bewaking op console- en page-errors; echte
 * errors laten de test falen. Screenshots → C:/temp/waveE-e2e/.
 *
 * Voorwaarden (al draaiend volgens de opdracht):
 *   - API :7300 (VITE_DEMO_MODE=false → echte api), DB geseed + crema-shop.
 *   - Admin :7301.
 *   - Login: admin@webshop-crm.local / admin12345.
 *   - Run eerst `node scripts/smoke-api.mjs` zodat de e2e-order bestaat.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@webshop-crm.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin12345';
const SHOT_DIR = 'C:/temp/waveE-e2e';

/** Per-assertie-resultaten zodat de runner ze aan het eind toont. */
const results: string[] = [];

/** Filter benign noise (favicon/devtools) maar vang echte console/page-errors. */
const BENIGN = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[vite\]/i,
  /Failed to load resource.*404.*favicon/i,
  // Pre-login /auth/me-probe geeft bewust 401 (graceful → toon login-form).
  // Dit is de gedocumenteerde happy-path, geen echte app-error.
  /Failed to load resource:.*401 \(Unauthorized\)/i,
];

function attachErrorGuards(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (BENIGN.some((re) => re.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return { errors };
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

test('Wave E3 command-center: login → dashboard → channels → orders → finance', async ({
  page,
}) => {
  const guard = attachErrorGuards(page);

  // ─── 1. Login ───────────────────────────────────────────────
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('#email').fill(ADMIN_EMAIL);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /inloggen/i }).click();

  // → /launch: kies de eerste winkel-card.
  await expect(page).toHaveURL(/\/launch$/, { timeout: 15_000 });
  const firstCard = page.locator('.launch-card').first();
  await expect(firstCard).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOT_DIR}/01-launch.png`, fullPage: true });
  await firstCard.click();

  // ─── 2. Dashboard — echte KPI's, niet-nul omzet ──────────────
  await expect(page).toHaveURL(/\/$|\/$/, { timeout: 15_000 });
  // KPI-kaart "Omzet (30d)" moet zichtbaar zijn met een bedrag.
  const omzetCard = page
    .locator('.kpi-card')
    .filter({ hasText: /Omzet \(30d\)/i })
    .first();
  await expect(omzetCard).toBeVisible({ timeout: 15_000 });
  const omzetValue = await omzetCard.locator('.kpi-value').first().innerText();
  // Niet-nul: er staat ten minste één 1-9 in het bedrag (geen "€ 0").
  expect(omzetValue, `dashboard omzet="${omzetValue}"`).toMatch(/[1-9]/);
  results.push(`PASS dashboard: Omzet (30d) = "${omzetValue.trim()}" (niet-nul)`);
  await page.screenshot({ path: `${SHOT_DIR}/02-dashboard.png`, fullPage: true });

  // ─── 3. /channels — own_webshop Verbonden + bol error/creds ──
  await page.goto('/channels');
  await expect(page.locator('h1.page-title', { hasText: /verkoop-kanalen/i })).toBeVisible({
    timeout: 15_000,
  });
  // Wacht tot de echte cards geladen zijn (niet de skeletons).
  await expect(page.locator('.card-title').first()).toBeVisible({ timeout: 15_000 });

  // own_webshop-card → "Verbonden"-badge.
  const ownCard = page
    .locator('.card')
    .filter({ has: page.locator('.card-title', { hasText: /eigen webshop/i }) })
    .first();
  await expect(ownCard).toBeVisible({ timeout: 10_000 });
  await expect(ownCard.getByText('Verbonden', { exact: true })).toBeVisible();
  results.push('PASS channels: own_webshop-card toont "Verbonden"');

  // bol-card → credentials-vereist of fout-state (NIET "Verbonden").
  const bolCard = page
    .locator('.card')
    .filter({ has: page.locator('.card-title', { hasText: /bol/i }) })
    .first();
  await expect(bolCard).toBeVisible({ timeout: 10_000 });
  const bolText = await bolCard.innerText();
  const bolNotLive =
    /credentials vereist|niet verbonden|fout|controleer credentials/i.test(bolText) &&
    !/^(?=.*\bVerbonden\b)(?!.*niet verbonden).*$/i.test(bolText);
  expect(bolNotLive, `bol-card text:\n${bolText}`).toBeTruthy();
  results.push('PASS channels: bol-card toont credentials-/fout-state (niet live)');
  await page.screenshot({ path: `${SHOT_DIR}/03-channels.png`, fullPage: true });

  // ─── 4. /orders — Alle shops + kanaal=web → e2e-order ────────
  await page.goto('/orders');
  await expect(page.locator('h1.page-title', { hasText: 'Orders' })).toBeVisible({ timeout: 15_000 });

  // Shop-scope expliciet op "Alle shops" (consolideer over álle shops).
  // NB: de TopBar-ShopSwitcher (aria-label="Actieve shop") heeft GEEN
  // "Alle shops"-optie — target de page-toolbar-select binnen .app-content.
  const shopScope = page
    .locator('.app-content select')
    .filter({ has: page.locator('option', { hasText: 'Alle shops' }) })
    .first();
  await shopScope.selectOption({ label: 'Alle shops' });

  // Kanaal-filter → "Webshop" (channel=web).
  await page.getByRole('button', { name: 'Webshop', exact: true }).click();

  // Zoek op de e2e-test-e-mail zodat de rij deterministisch is.
  const search = page.getByPlaceholder(/order-nr of e-mail/i);
  await search.fill('e2e@test.local');
  await page.waitForTimeout(600); // debounce 300ms

  // Tabel moet rijen tonen met de e2e-order (web-kanaal, gefilterd op test-e-mail).
  // De server-side search (order-nr / e-mail) levert ALLEEN orders van
  // e2e@test.local; elke rij is dus een echte storefront-order op het web-kanaal.
  const orderRows = page.locator('table tbody tr');
  await expect(orderRows.first()).toBeVisible({ timeout: 15_000 });
  const rowCount = await orderRows.count();
  expect(rowCount, `orders rijen (na zoek op e2e@test.local)=${rowCount}`).toBeGreaterThan(0);
  // De order-nummer-cel toont een echte storefront-order (CR-…-nummer).
  const orderNoCell = page.locator('table tbody tr td .mono').first();
  const orderNo = (await orderNoCell.innerText()).trim();
  expect(orderNo, `eerste order-nr="${orderNo}"`).toMatch(/^[A-Z]{2}-\d+$/);
  // En een web-kanaal-pill ("Webshop") moet in de tabel staan.
  // De ChannelPill rendert in `compact`-modus alleen de letter "W" met
  // title="Webshop" — assert op het title-attribuut binnen de tabel.
  await expect(
    page.locator('table tbody [title="Webshop"]').first(),
  ).toBeVisible();
  results.push(`PASS orders: ${rowCount} web-order(s) voor e2e@test.local zichtbaar (Alle shops + kanaal=web), bv. ${orderNo}`);
  await page.screenshot({ path: `${SHOT_DIR}/04-orders.png`, fullPage: true });

  // ─── 5. /finance — per-kanaal-tabel met Webshop-rij + niet-nul ─
  await page.goto('/finance');
  await expect(page.locator('h1.page-title', { hasText: /financieel/i })).toBeVisible({ timeout: 15_000 });

  // "Alle shops" + "Jaar" zodat de e2e-omzet zeker in het venster valt.
  const finScope = page.locator('select[aria-label="Shop"]');
  await finScope.selectOption({ label: 'Alle shops' });
  await page.getByRole('tab', { name: 'Jaar' }).click();

  // Per-kanaal-card met de tabel.
  const perKanaalCard = page
    .locator('.card')
    .filter({ has: page.locator('.card-title', { hasText: /per kanaal/i }) })
    .first();
  await expect(perKanaalCard).toBeVisible({ timeout: 15_000 });

  // Webshop-rij in de per-kanaal-tabel.
  const webshopRow = perKanaalCard
    .locator('table tbody tr')
    .filter({ hasText: /webshop/i })
    .first();
  await expect(webshopRow).toBeVisible({ timeout: 15_000 });

  // Geconsolideerde totaal-rij (tfoot) met een niet-nul bedrag.
  const totaalRow = perKanaalCard.locator('table tfoot tr').first();
  await expect(totaalRow).toBeVisible();
  const totaalText = await totaalRow.innerText();
  expect(totaalText, `finance totaal-rij="${totaalText}"`).toMatch(/[1-9]/);
  results.push(`PASS finance: per-kanaal-tabel met Webshop-rij + niet-nul totaal ("${totaalText.replace(/\s+/g, ' ').trim()}")`);
  await page.screenshot({ path: `${SHOT_DIR}/05-finance.png`, fullPage: true });

  // ─── Geen console/page-errors over de hele flow ──────────────
  expect(guard.errors, `console/page errors:\n${guard.errors.join('\n')}`).toEqual([]);
  results.push('PASS: geen console/page-errors gedurende de hele flow');
});

test.afterAll(() => {
  // eslint-disable-next-line no-console
  console.log('\n=== WAVE-E3 PLAYWRIGHT RESULTS ===\n' + results.join('\n') + '\n==================================');
});
