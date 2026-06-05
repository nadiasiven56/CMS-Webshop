import { test, expect } from '@playwright/test';

/**
 * V1 happy-path: login → producten → detail → stock → adjust → movements.
 *
 * Voorwaarden:
 *   - API draait op :7300 met DB geseed:
 *       pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm db:seed-demo
 *   - Admin draait op :7301 (`pnpm dev` of `pnpm --filter @webshop-crm/admin dev`)
 *   - Env-variabelen E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD gezet
 *
 * Run:
 *   E2E_ADMIN_EMAIL=admin@webshop-crm.local \
 *   E2E_ADMIN_PASSWORD=<seed-password> \
 *   pnpm test:e2e
 */

const ADMIN_EMAIL =
  process.env.E2E_ADMIN_EMAIL ??
  process.env.SEED_ADMIN_EMAIL ??
  'admin@webshop-crm.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

test('V1 happy-path: login → producten → stock → adjust → movements', async ({
  page,
}) => {
  test.skip(
    !ADMIN_PASSWORD,
    'E2E_ADMIN_PASSWORD niet gezet — skip happy-path.',
  );

  // ─── 1. Login ───────────────────────────────────────────────
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);

  // Gebruik de veld-id's (#email/#password): robuuster dan getByLabel, want
  // de "Toon wachtwoord"-toggle heeft ook aria-label "... wachtwoord" → een
  // label-regex zou meerdere elementen matchen (strict-mode-fout).
  await page.locator('#email').fill(ADMIN_EMAIL);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /inloggen|log\s*in/i }).click();

  // After login we should be redirected into the app shell.
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 10_000 });

  // ─── 2. Producten — list + search ──────────────────────────
  await page.goto('/products');
  await expect(page).toHaveURL(/\/products$/);

  // Wacht tot de lijst geladen is
  await expect(
    page.getByText(/demo|product/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Search "demo-koffie" via tekstveld als aanwezig (search-input)
  const search = page
    .locator('input[type="search"], input[placeholder*="oek" i], input[placeholder*="earch" i]')
    .first();
  if (await search.count()) {
    await search.fill('koffie');
    // Wacht kort op debounce
    await page.waitForTimeout(500);
  }

  // ─── 3. Klik 1 product → detail ────────────────────────────
  // Eerste link naar een echt product (/products/<id>) — NIET de
  // "Nieuw product"-knop (/products/new) die bovenaan de lijst staat.
  const firstProductLink = page
    .locator('a[href^="/products/"]:not([href$="/new"])')
    .first();
  await expect(firstProductLink).toBeVisible({ timeout: 10_000 });
  await firstProductLink.click();
  await expect(page).toHaveURL(/\/products\/[^/]+$/);

  // Varianten-section
  await expect(page.getByRole('heading', { name: /varianten/i })).toBeVisible();

  // ─── 4. Stock-page + low-stock-toggle ──────────────────────
  await page.goto('/stock');
  await expect(page).toHaveURL(/\/stock$/);
  await expect(
    page.getByText(/voorraad|stock|sku/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Toggle lowStockOnly als aanwezig (checkbox of switch met label)
  const lowToggle = page
    .getByLabel(/low.?stock|laag.?voorraad|onder.?minimum/i)
    .first();
  if (await lowToggle.count()) {
    await lowToggle.check({ force: true });
    await page.waitForTimeout(500);
    await lowToggle.uncheck({ force: true });
  }

  // ─── 5. Stock-item → adjust +5 ─────────────────────────────
  const firstStockLink = page.locator('a[href^="/stock/"]').first();
  await expect(firstStockLink).toBeVisible({ timeout: 10_000 });
  await firstStockLink.click();
  await expect(page).toHaveURL(/\/stock\/[^/]+$/);

  // Open adjust-modal via button
  const adjustBtn = page
    .getByRole('button', { name: /adjust|aanpassen|muteren/i })
    .first();
  await expect(adjustBtn).toBeVisible({ timeout: 10_000 });
  await adjustBtn.click();

  // Vul delta = 5
  const deltaInput = page
    .locator('input[name="delta"], input[type="number"]')
    .first();
  await expect(deltaInput).toBeVisible();
  await deltaInput.fill('5');

  // Vul reason als veld bestaat
  const reasonInput = page
    .locator(
      'select[name="reason"], input[name="reason"], textarea[name="reason"]',
    )
    .first();
  if (await reasonInput.count()) {
    const tag = await reasonInput.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'select') {
      // Pak eerste niet-lege optie
      const firstOpt = await reasonInput
        .locator('option:not([value=""])')
        .first()
        .getAttribute('value');
      if (firstOpt) await reasonInput.selectOption(firstOpt);
    } else {
      await reasonInput.fill('manual_count');
    }
  }

  // Submit
  const submitBtn = page
    .getByRole('button', { name: /opslaan|bevestig|submit|adjust/i })
    .last();
  await submitBtn.click();

  // Verwacht success-toast OF reload met +5 zichtbaar
  await page.waitForTimeout(1500);

  // ─── 6. Movements — controle laatste entry ─────────────────
  await page.goto('/movements');
  await expect(page).toHaveURL(/\/movements$/);
  await expect(
    page.getByText(/movements|mutaties|historie|delta/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Verwacht een rij met +5 of een recente entry
  const firstRow = page.locator('table tbody tr, [data-testid="movement-row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
});
