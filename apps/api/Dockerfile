# ─────────────────────────────────────────────────────────────
# Webshop-CRM API — productie-image
#
# Runtime = tsx. Dit is exact de runtime waarop dev + de 293 unit-tests +
# de end-to-end smoke al groen draaien. tsx draait de TypeScript-source
# direct (eigen esbuild), dus:
#   - geen afhankelijkheid van Node's experimentele .ts-stripping
#   - de import.meta.url-padresolutie (.env / drizzle-migraties) blijft kloppen
#   - werkt identiek op elke Node >= 18
# De API heeft GEEN native dependencies (auth = bcryptjs, db = postgres-js),
# dus node:22-slim zonder build-tools volstaat.
# ─────────────────────────────────────────────────────────────
FROM node:22-slim

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# 1) Alleen manifests + lockfile eerst → betere layer-cache bij code-wijzigingen.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json

# Volledige frozen install (deterministisch). tsx zit in de api-dependencies,
# dus de runtime heeft alles nodig. devDeps zijn klein en pure-JS.
RUN pnpm install --frozen-lockfile

# 2) Source: alleen wat de API runtime nodig heeft (shared + api).
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# 3) Entrypoint: migraties (met retry tot DB klaar) → idempotente seed → serve.
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# In een container moet de server op alle interfaces luisteren.
ENV API_HOST=0.0.0.0
ENV API_PORT=7300
EXPOSE 7300

# Healthcheck tegen /health.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||7300)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
