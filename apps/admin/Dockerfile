# ─────────────────────────────────────────────────────────────
# Webshop-CRM Admin — productie-image (static SPA + reverse-proxy)
#
# Stage 1 bouwt de Vite/React-SPA tot static assets.
# Stage 2 is Caddy: serveert die assets én proxyt /api → de api-container,
# zodat alles op één origin draait (zie Caddyfile).
# ─────────────────────────────────────────────────────────────

# ── Stage 1: build ──
FROM node:22-slim AS build
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/admin ./apps/admin

# Optioneel: publieke API-base voor het storefront-connect-snippet dat in de
# admin getoond wordt (Shops → Koppel je webshop). Niet nodig voor de admin
# zelf (die praat relatief via /api). Bv: https://crm.jouwdomein.nl/api
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm --filter @webshop-crm/admin build

# ── Stage 2: Caddy serveert static + proxyt /api ──
FROM caddy:2-alpine
COPY apps/admin/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/admin/dist /srv
EXPOSE 80 443
