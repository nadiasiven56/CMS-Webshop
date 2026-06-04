/**
 * Payments-router — `/api/payments/*` (Wave-H A4).
 *
 * Mollie webhook intake. This sub-router is PUBLIC (no `requireAuth`): Mollie
 * calls it server-to-server. Security model = "the webhook tells us nothing we
 * trust": the body only carries a payment `id`; we NEVER trust a status from the
 * body. We fetch the authoritative status from Mollie ourselves (GET
 * /v2/payments/{id}) using the shop's own key before mutating anything.
 *
 * Mount (finalizer, see registerMd):
 *   apiRoutes.route('/payments', paymentsRoutes);
 * → POST /api/payments/mollie/webhook
 */
import { Hono } from 'hono';
import { mollieWebhook } from './mollie-webhook.js';

export const paymentsRoutes = new Hono();

// PUBLIC — Mollie posts `id` as x-www-form-urlencoded. No auth.
paymentsRoutes.post('/mollie/webhook', mollieWebhook);

// Lightweight health for the public payments surface (no shop needed).
paymentsRoutes.get('/health', (c) => c.json({ ok: true, scope: 'payments' }));
