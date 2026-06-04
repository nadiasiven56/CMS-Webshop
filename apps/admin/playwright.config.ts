import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config voor Webshop-CRM admin E2E.
 *
 * Verwacht dat zowel API (:7300) als admin (:7301) al draaien:
 *   pnpm dev   # in andere terminal
 *
 * En dat de DB geseed is met admin-user + demo-products:
 *   pnpm db:seed && pnpm db:seed-demo
 *
 * E2E-credentials worden uit env-variabelen gelezen:
 *   E2E_ADMIN_EMAIL    (default: SEED_ADMIN_EMAIL of admin@webshop-crm.local)
 *   E2E_ADMIN_PASSWORD (verplicht; geen default)
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:7301',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
