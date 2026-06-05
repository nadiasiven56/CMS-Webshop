#!/bin/sh
# ─────────────────────────────────────────────────────────────
# API-container entrypoint:
#   1) DB-migraties draaien (met retry tot Postgres bereikbaar is)
#   2) Idempotente seed (admin-user + locatie + vat-rates + channels)
#   3) De API serveren (tsx, productie)
# ─────────────────────────────────────────────────────────────
set -e
cd /app

echo "[entrypoint] migraties draaien (retry tot DB klaar)..."
i=0
until pnpm --filter @webshop-crm/api db:migrate; do
  i=$((i + 1))
  if [ "$i" -ge 20 ]; then
    echo "[entrypoint] FOUT: migraties bleven falen — is DATABASE_URL correct?"
    exit 1
  fi
  echo "[entrypoint]   database nog niet klaar, retry $i/20..."
  sleep 2
done
echo "[entrypoint] migraties OK."

echo "[entrypoint] seed (idempotent)..."
# De seed is zelf idempotent: een re-seed op een al-gevulde DB exit 0 (no-op).
# We maskeren de exit-code dus NIET meer met '|| echo OK': een ECHTE seed-crash
# (DB-fout, code-bug, half-geseede staat) MOET de container laten falen zodat
# 'restart: unless-stopped' 'm opnieuw probeert i.p.v. stil door te starten.
if pnpm --filter @webshop-crm/api seed; then
  echo "[entrypoint] seed OK (vers of al aanwezig)."
else
  echo "[entrypoint] FOUT: seed faalde (exit $?) — container stopt zodat restart 'm oppakt."
  exit 1
fi

echo "[entrypoint] API starten..."
exec pnpm --filter @webshop-crm/api start
