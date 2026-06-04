/**
 * Notifications/email-router — `/api/notifications/*`.
 *
 * Transactionele-email-beheer (CONNECT-READY): pluggable email-provider
 * (smtp/postmark/sendgrid/mailgun) + email-templates + append-only delivery-log.
 * De route-laag praat NOOIT direct met een provider-API — altijd via een
 * {@link EmailProvider} uit de provider-registry. De daadwerkelijke verzending
 * van transactionele mails (vanuit orders/returns) loopt via de publieke
 * service `sendNotification(...)` in `domain/notifications/send.ts`.
 *
 * Endpoints (alle achter `requireAuth`):
 *   GET    /api/notifications/providers                       — list (masked creds)
 *   POST   /api/notifications/providers                       — create {provider,name,config}
 *   GET    /api/notifications/providers/:id                   — detail
 *   PATCH  /api/notifications/providers/:id                   — partial update
 *   DELETE /api/notifications/providers/:id                   — delete
 *   PUT    /api/notifications/providers/:id/credentials       — encrypt → store
 *   POST   /api/notifications/providers/:id/test-connection   — verify → persist status
 *   POST   /api/notifications/providers/:id/activate          — set active (others off)
 *   GET    /api/notifications/templates                       — list templates
 *   GET    /api/notifications/templates/:key                  — template detail
 *   PATCH  /api/notifications/templates/:key                  — edit subject/body/enabled
 *   POST   /api/notifications/test-send                       — send a sample via a template
 *   GET    /api/notifications/log?to=&order_id=&limit=&offset= — delivery-log
 *
 * KRITISCH: credentials worden encrypted opgeslagen (channel-crypto) en NOOIT
 * raw teruggegeven (alleen masked presence-map via _serialize).
 *
 * Wired in routes/index.ts door de orchestrator — zie REGISTER.md.
 */
import { Hono } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { isUuid } from '../../domain/shops/shop-context.js';
import { runInTransactionWithAudit } from '../../domain/stock/transaction-helpers.js';
import { encryptCredentials } from '../../lib/channel-crypto.js';
import {
  emailProviderConfig,
  emailTemplates,
  emailLog,
} from '../../db/schema/notifications.js';
import { getEmailProvider } from '../../domain/notifications/providers/index.js';
import { sendNotification } from '../../domain/notifications/send.js';
import {
  CREDENTIALS_SCHEMA_BY_PROVIDER,
  EmailLogQuerySchema,
  ProviderConfigCreateSchema,
  ProviderConfigPatchSchema,
  ProviderListQuerySchema,
  TemplatePatchSchema,
  TestSendSchema,
} from './_schemas.js';
import { toProviderDto, toTemplateDto, toEmailLogDto } from './_serialize.js';

export const notificationRoutes = new Hono<{ Variables: AuthVariables }>();

// Auth op alles — admin-module.
notificationRoutes.use('*', requireAuth);

const ip = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null;

/** Sample-data zodat een test-send altijd alle {{var}}-placeholders vult. */
const SAMPLE_DATA: Record<string, unknown> = {
  customerName: 'Jan Jansen',
  orderNumber: 'WC-100245',
  total: '€ 49,95',
  trackingUrl: 'https://track.example.com/abc123',
};

// ════════════════════════════════════════════════════════════
// Providers
// ════════════════════════════════════════════════════════════

// ─── GET /providers — list ───────────────────────────────────

notificationRoutes.get('/providers', async (c) => {
  const parsed = ProviderListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { provider, status, limit, offset } = parsed.data;

  const conditions = [];
  if (provider) conditions.push(eq(emailProviderConfig.provider, provider));
  if (status) conditions.push(eq(emailProviderConfig.status, status));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(emailProviderConfig)
    .orderBy(desc(emailProviderConfig.isActive), asc(emailProviderConfig.name))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: emailProviderConfig.id }).from(emailProviderConfig).where(whereExpr)
    : db.select({ id: emailProviderConfig.id }).from(emailProviderConfig));

  return c.json({
    items: rows.map(toProviderDto),
    total: allIds.length,
    limit,
    offset,
  });
});

// ─── POST /providers — create ────────────────────────────────

notificationRoutes.post('/providers', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ProviderConfigCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  const provider = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .insert(emailProviderConfig)
      .values({
        provider: input.provider,
        name: input.name,
        status: 'disconnected',
        config: input.config ?? {},
        isActive: false,
      })
      .returning();
    if (!row) throw new Error('email_provider_config insert returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'create',
      entityType: 'email_provider',
      entityId: row.id,
      before: null,
      after: { id: row.id, provider: row.provider, name: row.name, status: row.status },
      ip: ip(c),
    });
    return row;
  });

  logger.info(
    { providerId: provider.id, provider: provider.provider, actor: user.id },
    'email provider created',
  );
  return c.json({ provider: toProviderDto(provider) }, 201);
});

// ─── GET /providers/:id — detail ─────────────────────────────

notificationRoutes.get('/providers/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [provider] = await db
    .select()
    .from(emailProviderConfig)
    .where(eq(emailProviderConfig.id, id))
    .limit(1);
  if (!provider) return c.json({ error: 'not_found' }, 404);

  return c.json({ provider: toProviderDto(provider) });
});

// ─── PATCH /providers/:id — update ───────────────────────────

notificationRoutes.patch('/providers/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = ProviderConfigPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;

  const [existing] = await db
    .select()
    .from(emailProviderConfig)
    .where(eq(emailProviderConfig.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) setValues.name = patch.name;
  if (patch.config !== undefined) setValues.config = patch.config;
  if (patch.status !== undefined) setValues.status = patch.status;

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(emailProviderConfig)
      .set(setValues)
      .where(eq(emailProviderConfig.id, id))
      .returning();
    if (!row) throw new Error('email_provider_config update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'email_provider',
      entityId: row.id,
      before: { name: existing.name, status: existing.status, config: existing.config },
      after: { name: row.name, status: row.status, config: row.config },
      ip: ip(c),
    });
    return row;
  });

  logger.info({ providerId: id, actor: user.id }, 'email provider updated');
  return c.json({ provider: toProviderDto(updated) });
});

// ─── DELETE /providers/:id ───────────────────────────────────

notificationRoutes.delete('/providers/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [existing] = await db
    .select()
    .from(emailProviderConfig)
    .where(eq(emailProviderConfig.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  await runInTransactionWithAudit(async (tx, audit) => {
    await tx.delete(emailProviderConfig).where(eq(emailProviderConfig.id, id));
    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'delete',
      entityType: 'email_provider',
      entityId: id,
      before: { id: existing.id, provider: existing.provider, name: existing.name },
      after: null,
      ip: ip(c),
    });
  });

  logger.info({ providerId: id, actor: user.id }, 'email provider deleted');
  return c.json({ ok: true, id });
});

// ─── PUT /providers/:id/credentials — encrypt + store ────────

notificationRoutes.put('/providers/:id/credentials', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [existing] = await db
    .select()
    .from(emailProviderConfig)
    .where(eq(emailProviderConfig.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const schema =
    CREDENTIALS_SCHEMA_BY_PROVIDER[
      existing.provider as keyof typeof CREDENTIALS_SCHEMA_BY_PROVIDER
    ];
  if (schema === undefined) {
    return c.json({ error: 'unsupported_provider', provider: existing.provider }, 422);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }

  const encrypted = encryptCredentials(parsed.data as Record<string, unknown>);

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(emailProviderConfig)
      .set({ credentials: encrypted, updatedAt: new Date() })
      .where(eq(emailProviderConfig.id, id))
      .returning();
    if (!row) throw new Error('email_provider_config credentials update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'email_provider',
      entityId: row.id,
      // NOOIT de raw creds in audit — alleen dat ze gezet zijn.
      before: { hadCredentials: existing.credentials != null },
      after: { hasCredentials: true, fields: Object.keys(parsed.data as object) },
      ip: ip(c),
    });
    return row;
  });

  logger.info({ providerId: id, actor: user.id }, 'email provider credentials stored');
  return c.json({ provider: toProviderDto(updated) });
});

// ─── POST /providers/:id/test-connection ─────────────────────

notificationRoutes.post('/providers/:id/test-connection', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [provider] = await db
    .select()
    .from(emailProviderConfig)
    .where(eq(emailProviderConfig.id, id))
    .limit(1);
  if (!provider) return c.json({ error: 'not_found' }, 404);

  const adapter = getEmailProvider(provider.provider);
  if (!adapter) {
    return c.json({ error: 'unsupported_provider', provider: provider.provider }, 422);
  }

  // verifyConnection decrypteert in-memory (binnen de adapter) en throwt NOOIT.
  const verify = await adapter.verifyConnection(provider);
  const nextStatus = verify.ok ? 'connected' : 'error';

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(emailProviderConfig)
      .set({ status: nextStatus, lastTestAt: new Date(), updatedAt: new Date() })
      .where(eq(emailProviderConfig.id, id))
      .returning();
    if (!row) throw new Error('email_provider_config status update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'email_provider',
      entityId: row.id,
      before: { status: provider.status },
      after: { status: row.status, verifyDetail: verify.detail },
      ip: ip(c),
    });
    return row;
  });

  return c.json({
    ok: verify.ok,
    detail: verify.detail,
    provider: toProviderDto(updated),
  });
});

// ─── POST /providers/:id/activate — single-active-provider ───

notificationRoutes.post('/providers/:id/activate', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const user = c.get('user');
  const [provider] = await db
    .select()
    .from(emailProviderConfig)
    .where(eq(emailProviderConfig.id, id))
    .limit(1);
  if (!provider) return c.json({ error: 'not_found' }, 404);

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    // Single-active-provider: zet alle andere uit, deze aan.
    await tx
      .update(emailProviderConfig)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(emailProviderConfig.isActive, true));
    const [row] = await tx
      .update(emailProviderConfig)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(emailProviderConfig.id, id))
      .returning();
    if (!row) throw new Error('email_provider_config activate returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'email_provider',
      entityId: row.id,
      before: { isActive: provider.isActive },
      after: { isActive: true },
      ip: ip(c),
    });
    return row;
  });

  logger.info({ providerId: id, actor: user.id }, 'email provider activated');
  return c.json({ provider: toProviderDto(updated) });
});

// ════════════════════════════════════════════════════════════
// Templates
// ════════════════════════════════════════════════════════════

// ─── GET /templates — list ───────────────────────────────────

notificationRoutes.get('/templates', async (c) => {
  const rows = await db
    .select()
    .from(emailTemplates)
    .orderBy(asc(emailTemplates.key));
  return c.json({ items: rows.map(toTemplateDto), total: rows.length });
});

// ─── GET /templates/:key — detail ────────────────────────────

notificationRoutes.get('/templates/:key', async (c) => {
  const key = c.req.param('key');
  const [template] = await db
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.key, key))
    .limit(1);
  if (!template) return c.json({ error: 'not_found' }, 404);
  return c.json({ template: toTemplateDto(template) });
});

// ─── PATCH /templates/:key — edit subject/body/enabled ───────

notificationRoutes.patch('/templates/:key', async (c) => {
  const key = c.req.param('key');
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = TemplatePatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const patch = parsed.data;

  const [existing] = await db
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.key, key))
    .limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) setValues.name = patch.name;
  if (patch.subject !== undefined) setValues.subject = patch.subject;
  if (patch.bodyHtml !== undefined) setValues.bodyHtml = patch.bodyHtml;
  if (patch.bodyText !== undefined) setValues.bodyText = patch.bodyText;
  if (patch.enabled !== undefined) setValues.enabled = patch.enabled;
  if (patch.locale !== undefined) setValues.locale = patch.locale;

  const updated = await runInTransactionWithAudit(async (tx, audit) => {
    const [row] = await tx
      .update(emailTemplates)
      .set(setValues)
      .where(eq(emailTemplates.key, key))
      .returning();
    if (!row) throw new Error('email_templates update returned no row');

    audit.set({
      actor: { type: 'user', id: user.id },
      action: 'update',
      entityType: 'email_template',
      entityId: row.id,
      before: { subject: existing.subject, enabled: existing.enabled },
      after: { subject: row.subject, enabled: row.enabled },
      ip: ip(c),
    });
    return row;
  });

  logger.info({ templateKey: key, actor: user.id }, 'email template updated');
  return c.json({ template: toTemplateDto(updated) });
});

// ════════════════════════════════════════════════════════════
// Test-send + log
// ════════════════════════════════════════════════════════════

// ─── POST /test-send ─────────────────────────────────────────
//
// Verstuurt een sample-mail via de publieke sendNotification-service. Als er
// geen actieve connected provider is → status 'skipped_no_provider' met een
// duidelijke message (NOOIT een 500 — dit is het koppel-klaar-gedrag).

notificationRoutes.post('/test-send', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = TestSendSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { to, templateKey } = parsed.data;

  const result = await sendNotification({
    templateKey,
    to,
    data: SAMPLE_DATA,
  });

  const message =
    result.status === 'skipped_no_provider'
      ? 'Geen actieve, verbonden email-provider — er is niets verstuurd. Koppel eerst een provider en activeer hem.'
      : result.status === 'sent'
        ? 'Test-mail verstuurd.'
        : 'Test-mail kon niet worden verstuurd — zie de delivery-log voor details.';

  logger.info(
    { to, templateKey, status: result.status, actor: user.id },
    'email test-send',
  );
  return c.json({ status: result.status, logId: result.logId, message });
});

// ─── GET /log ────────────────────────────────────────────────

notificationRoutes.get('/log', async (c) => {
  const parsed = EmailLogQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }
  const { to, order_id, limit, offset } = parsed.data;

  const conditions = [];
  if (to) conditions.push(eq(emailLog.toEmail, to));
  if (order_id) conditions.push(eq(emailLog.orderId, order_id));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsQuery = db
    .select()
    .from(emailLog)
    .orderBy(desc(emailLog.createdAt))
    .limit(limit)
    .offset(offset)
    .$dynamic();
  const rows = whereExpr ? await rowsQuery.where(whereExpr) : await rowsQuery;

  const allIds = await (whereExpr
    ? db.select({ id: emailLog.id }).from(emailLog).where(whereExpr)
    : db.select({ id: emailLog.id }).from(emailLog));

  return c.json({
    items: rows.map(toEmailLogDto),
    total: allIds.length,
    limit,
    offset,
  });
});
