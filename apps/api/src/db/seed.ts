/**
 * Seed-script — minimale dataset om in te kunnen loggen en stock te muteren.
 *
 *   Run: `pnpm --filter @webshop-crm/api seed`
 *
 * Idempotent: kan herhaaldelijk gerund worden zonder duplicates.
 *
 * Wat wordt geseed (Fase 1):
 *   - 1 admin-user (uit env SEED_ADMIN_EMAIL/PASSWORD)
 *   - 1 default location 'main'
 *
 * Demo-products (50 SKU's) komt in feature-agent product-CRUD zoals
 * V1-ROADMAP voorschrijft (deliverable van die agent, niet hier).
 */
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../lib/db.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { hashPassword } from '../lib/auth.js';
import { users, locations } from './schema/index.js';
import { seedVatRates } from './seed-vat.js';
import { seedChannels } from './seed-channels.js';
// Round 3 — integrations:
import { seedShipping } from './seed-shipping.js';
import { seedAccounting } from './seed-accounting.js';
import { seedNotifications } from './seed-notifications.js';
import { seedDiscounts } from './seed-discounts.js';
import { seedWebhookDeliveries } from './seed-webhooks.js';
import { seedReviews } from './seed-reviews.js';
import { seedMarketing } from './seed-marketing.js';

async function seedAdminUser(): Promise<void> {
  const email = env.SEED_ADMIN_EMAIL;
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    logger.info({ email }, 'admin-user already exists, skipping');
    return;
  }
  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);
  await db.insert(users).values({
    email,
    passwordHash,
    role: 'admin',
  });
  logger.info({ email }, 'admin-user created');
}

async function seedDefaultLocation(): Promise<void> {
  const existing = await db.select().from(locations).where(eq(locations.code, 'main')).limit(1);
  if (existing.length > 0) {
    logger.info({ code: 'main' }, 'default location already exists, skipping');
    return;
  }
  await db.insert(locations).values({
    code: 'main',
    name: 'Hoofdmagazijn',
    type: 'warehouse',
    priority: 100,
    active: true,
  });
  logger.info({ code: 'main' }, 'default location created');
}

async function main() {
  logger.info('Seeding…');
  await seedAdminUser();
  await seedDefaultLocation();
  await seedVatRates();
  await seedChannels();
  // ─── Round 3 — integrations (idempotent) ───────────────────
  await seedShipping();
  await seedAccounting();
  await seedNotifications();
  await seedDiscounts();
  await seedWebhookDeliveries();
  await seedReviews();
  // seedMarketing depends on shops existing; tolerant of 0 shops (no-op),
  // run last so any shop-seed earlier in the flow is already applied.
  await seedMarketing();
  logger.info('Seed OK.');
}

main()
  .catch((err) => {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
