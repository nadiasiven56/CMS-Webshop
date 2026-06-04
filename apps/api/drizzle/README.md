# Drizzle migrations

Auto-gegenereerd via `pnpm --filter @webshop-crm/api db:generate`.

## Stand op moment van Fase 1 oplevering

- `0000_initial_foundation.sql` — foundation-tabellen (handmatig samengesteld door Atlas conform Drizzle conventies)
- `meta/_journal.json` — migration-index voor de runner

## Re-genereren (aanbevolen na merge van feature-agent schemas)

```sh
# Drop deze migrations + meta/, dan:
pnpm --filter @webshop-crm/api db:generate
```

Drizzle-kit zal dan een fresh `0000_*.sql` + `meta/0000_snapshot.json` schrijven
op basis van `src/db/schema/index.ts`. De handmatige SQL hier is **referentie-
correct** maar drizzle-kit's eigen output is autoritair.

## Toevoegen van nieuwe migration (feature-agent ronde)

1. Maak/bewerk schema-file in `src/db/schema/<je-tabel>.ts`
2. Re-export hem in `src/db/schema/index.ts`
3. `pnpm --filter @webshop-crm/api db:generate`
4. Inspecteer de gegenereerde SQL — verwijder per ongeluk gegenereerde "drop"-statements voor andere agents' tabellen
5. `pnpm --filter @webshop-crm/api db:migrate`

NOOIT bestaande migrations editen — voeg een nieuwe toe.
