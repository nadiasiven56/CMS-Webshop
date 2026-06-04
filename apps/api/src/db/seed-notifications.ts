/**
 * Seed-uitbreiding — transactionele-email (`email_templates` + 'smtp' provider).
 *
 *   Run direct:   `pnpm --filter @webshop-crm/api exec tsx src/db/seed-notifications.ts`
 *   Of via Atlas: `seedNotifications()` aanhaken in de hoofd-seed-flow (seed.ts).
 *
 * Idempotent:
 *   - `email_templates.key` is UNIQUE, dus we leunen op `onConflictDoNothing`.
 *   - `email_provider_config` heeft GEEN unique op `provider`; we checken per
 *     provider op bestaan en slaan over als die er al is (mirror seedChannels).
 *
 * Wat wordt geseed (Dutch defaults, locale 'nl'):
 *   - templates: order_confirmation, order_shipped, order_refunded,
 *     return_received, welcome — met {{customerName}}, {{orderNumber}},
 *     {{total}}, {{trackingUrl}} placeholders.
 *   - 1 'smtp' provider-row als disconnected + inactive (placeholder).
 *
 * Credentials blijven leeg; die worden later via channel-crypto encrypted
 * opgeslagen wanneer de operator een provider koppelt + activeert.
 */
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import {
  emailProviderConfig,
  emailTemplates,
} from './schema/notifications.js';

export interface EmailTemplateSeedRow {
  key: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

/** Kleine HTML-wrapper zodat de seed-templates er net uitzien. */
function wrap(title: string, inner: string): string {
  return [
    '<!doctype html>',
    '<html lang="nl"><body style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;line-height:1.5;">',
    `<h2 style="margin:0 0 12px;">${title}</h2>`,
    inner,
    '<p style="margin-top:24px;color:#888;font-size:12px;">Deze e-mail is automatisch verstuurd door de webshop.</p>',
    '</body></html>',
  ].join('\n');
}

/** Bron-dataset — Nederlandse default-templates. */
export const EMAIL_TEMPLATE_SEED_ROWS: EmailTemplateSeedRow[] = [
  {
    key: 'order_confirmation',
    name: 'Orderbevestiging',
    subject: 'Bevestiging van je bestelling {{orderNumber}}',
    bodyHtml: wrap(
      'Bedankt voor je bestelling!',
      '<p>Hoi {{customerName}},</p>' +
        '<p>We hebben je bestelling <strong>{{orderNumber}}</strong> goed ontvangen. ' +
        'Het totaalbedrag is <strong>{{total}}</strong>.</p>' +
        '<p>Je ontvangt een nieuwe e-mail zodra je pakket onderweg is.</p>',
    ),
    bodyText:
      'Hoi {{customerName}},\n\n' +
      'We hebben je bestelling {{orderNumber}} goed ontvangen. ' +
      'Het totaalbedrag is {{total}}.\n\n' +
      'Je ontvangt een nieuwe e-mail zodra je pakket onderweg is.',
  },
  {
    key: 'order_shipped',
    name: 'Bestelling verzonden',
    subject: 'Je bestelling {{orderNumber}} is onderweg',
    bodyHtml: wrap(
      'Je pakket is onderweg!',
      '<p>Hoi {{customerName}},</p>' +
        '<p>Goed nieuws: je bestelling <strong>{{orderNumber}}</strong> is verzonden.</p>' +
        '<p>Je kunt je pakket volgen via deze link: ' +
        '<a href="{{trackingUrl}}">{{trackingUrl}}</a>.</p>',
    ),
    bodyText:
      'Hoi {{customerName}},\n\n' +
      'Goed nieuws: je bestelling {{orderNumber}} is verzonden.\n' +
      'Volg je pakket via: {{trackingUrl}}',
  },
  {
    key: 'order_refunded',
    name: 'Terugbetaling verwerkt',
    subject: 'Terugbetaling voor bestelling {{orderNumber}}',
    bodyHtml: wrap(
      'Je terugbetaling is verwerkt',
      '<p>Hoi {{customerName}},</p>' +
        '<p>We hebben een terugbetaling van <strong>{{total}}</strong> verwerkt voor je ' +
        'bestelling <strong>{{orderNumber}}</strong>. Afhankelijk van je bank kan het ' +
        'enkele werkdagen duren voordat het bedrag op je rekening staat.</p>',
    ),
    bodyText:
      'Hoi {{customerName}},\n\n' +
      'We hebben een terugbetaling van {{total}} verwerkt voor je bestelling ' +
      '{{orderNumber}}. Dit kan enkele werkdagen duren.',
  },
  {
    key: 'return_received',
    name: 'Retour ontvangen',
    subject: 'We hebben je retour ontvangen ({{orderNumber}})',
    bodyHtml: wrap(
      'Je retour is binnen',
      '<p>Hoi {{customerName}},</p>' +
        '<p>We hebben je retour voor bestelling <strong>{{orderNumber}}</strong> in goede ' +
        'orde ontvangen. We controleren de artikelen en verwerken je terugbetaling zo snel ' +
        'mogelijk.</p>',
    ),
    bodyText:
      'Hoi {{customerName}},\n\n' +
      'We hebben je retour voor bestelling {{orderNumber}} ontvangen. ' +
      'We verwerken je terugbetaling zo snel mogelijk.',
  },
  {
    key: 'welcome',
    name: 'Welkom',
    subject: 'Welkom bij onze webshop, {{customerName}}!',
    bodyHtml: wrap(
      'Welkom!',
      '<p>Hoi {{customerName}},</p>' +
        '<p>Leuk dat je een account hebt aangemaakt. Je kunt nu sneller bestellen en je ' +
        'bestellingen volgen.</p>',
    ),
    bodyText:
      'Hoi {{customerName}},\n\n' +
      'Leuk dat je een account hebt aangemaakt. Je kunt nu sneller bestellen en ' +
      'je bestellingen volgen.',
  },
];

export interface EmailProviderSeedRow {
  provider: string;
  name: string;
  status: 'connected' | 'disconnected';
}

/** Default provider-placeholder (disconnected + inactive). */
export const EMAIL_PROVIDER_SEED_ROWS: EmailProviderSeedRow[] = [
  { provider: 'smtp', name: 'SMTP', status: 'disconnected' },
];

/**
 * Idempotente seed van default-templates + provider-placeholder. Geeft het
 * aantal feitelijk ingevoegde rijen terug.
 */
export async function seedNotifications(): Promise<{
  templatesInserted: number;
  providersInserted: number;
}> {
  // ─── Templates (UNIQUE key → onConflictDoNothing) ──────────
  let templatesInserted = 0;
  for (const row of EMAIL_TEMPLATE_SEED_ROWS) {
    const res = await db
      .insert(emailTemplates)
      .values({
        key: row.key,
        name: row.name,
        subject: row.subject,
        bodyHtml: row.bodyHtml,
        bodyText: row.bodyText,
        enabled: true,
        locale: 'nl',
      })
      .onConflictDoNothing({ target: emailTemplates.key })
      .returning({ id: emailTemplates.id });
    if (res.length > 0) {
      templatesInserted += 1;
      logger.info({ key: row.key }, 'email template created');
    } else {
      logger.info({ key: row.key }, 'email template already exists, skipping');
    }
  }

  // ─── Provider-placeholder (check-per-provider) ─────────────
  let providersInserted = 0;
  for (const row of EMAIL_PROVIDER_SEED_ROWS) {
    const existing = await db
      .select({ id: emailProviderConfig.id })
      .from(emailProviderConfig)
      .where(eq(emailProviderConfig.provider, row.provider))
      .limit(1);
    if (existing.length > 0) {
      logger.info({ provider: row.provider }, 'email provider already exists, skipping');
      continue;
    }
    await db.insert(emailProviderConfig).values({
      provider: row.provider,
      name: row.name,
      status: row.status,
      isActive: false,
      // credentials/config blijven op schema-default (null / {}).
    });
    providersInserted += 1;
    logger.info({ provider: row.provider }, 'email provider created');
  }

  logger.info(
    {
      templatesInserted,
      templatesTotal: EMAIL_TEMPLATE_SEED_ROWS.length,
      providersInserted,
      providersTotal: EMAIL_PROVIDER_SEED_ROWS.length,
    },
    'notifications seeded',
  );
  return { templatesInserted, providersInserted };
}

// ─── CLI-entry (alleen als dit bestand direct gerund wordt) ──────────
//
// Detecteer "direct uitgevoerd" via het script-pad in argv[1]. Bij import (door
// seed.ts of een test) draait dit blok NIET.
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /seed-notifications\.[tj]s$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  seedNotifications()
    .then((r) => {
      logger.info(r, 'seed-notifications OK');
    })
    .catch((err) => {
      logger.error({ err }, 'seed-notifications failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
