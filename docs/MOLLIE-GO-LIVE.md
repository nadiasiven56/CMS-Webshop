# Mollie go-live — echte betalingen aanzetten

De Mollie-betaalflow is **code-compleet en end-to-end geverifieerd** (op de echte
Mollie-API-call na, die je sleutel vereist). "Koppelen" is daardoor letterlijk:
**je key invullen + de CRM publiek bereikbaar maken.**

## De flow (wat er gebeurt zodra er een key is)

```
storefront checkout ──POST /cart/:token/checkout──► API
   API: shop heeft Mollie-key?  ──ja──► maak Mollie-payment ──► geeft checkoutUrl terug
   storefront ──window.location = checkoutUrl──► Mollie betaalpagina (iDEAL/kaart/…)
   klant betaalt ──► Mollie redirect ──► storefront /checkout/return?order=..&shop=..
   Mollie ──POST webhook──► API /api/payments/mollie/webhook
        API verifieert status bij Mollie (nooit de body vertrouwen)
        'paid' ──► order = betaald + omzet in grootboek (idempotent)
   /checkout/return pollt GET /orders/:nr/status ──► "Betaling geslaagd / in behandeling / mislukt"
```

Zonder key verandert er **niets**: de checkout blijft het mock-pad (direct "betaald" → /bedankt).

## Wat jij doet (3 stappen)

1. **Mollie-account + key.** Maak een account op mollie.com, pak een API-key:
   `test_…` om te proeven (gratis test-betalingen), later `live_…`.
2. **Key invullen in de admin.** Ga naar **Shops → [jouw shop] → Betalingen**, kies
   provider *Mollie*, plak de key, opslaan. De key wordt **encrypted** opgeslagen
   (AES-256-GCM via `CHANNEL_SECRET_KEY`); hij is daarna nooit meer leesbaar in de UI.
3. **CRM publiek bereikbaar.** Mollie roept de webhook server-to-server aan, dus
   `…/api/payments/mollie/webhook` moet vanaf internet bereikbaar zijn:
   - **Productie**: automatisch zodra je op je domein draait (de deploy-stack uit
     `docs/DEPLOY.md`). Zet `API_PUBLIC_URL=https://crm.jouwdomein.nl` (de webhook-URL
     wordt hieruit afgeleid).
   - **Lokaal proeven**: zet een tunnel op (bv. `cloudflared tunnel --url http://localhost:7300`)
     en zet `API_PUBLIC_URL` op die publieke tunnel-URL.

   > Mollie accepteert geen `localhost`-webhook — een publieke URL is verplicht, ook
   > voor test-betalingen.

## Zo test je het (met een `test_`-key)

1. Key invullen (stap 2) + CRM publiek (stap 3, tunnel volstaat).
2. In de storefront: product → winkelwagen → afrekenen.
3. Je wordt nu naar **Mollie's testpagina** gestuurd → kies "paid" (iDEAL-test).
4. Je keert terug op **/checkout/return** → "Betaling geslaagd" zodra de webhook binnen is
   (de pagina pollt automatisch).
5. In de admin: de order staat op **Betaald** en de omzet is in het grootboek geboekt.

Kies in de Mollie-testpagina "failed/expired/canceled" → de terugkeerpagina toont
"Betaling niet gelukt" en de order blijft onbetaald (niets afgeschreven).

## Wat al geverifieerd is (zonder key)

- `GET /api/storefront/v1/orders/:nr/status` — live + 6 unit-tests (paid / failed /
  pending / 404 / shop-scoping / 400).
- Storefront `/checkout/return` — rendert "Betaling geslaagd" tegen een betaalde order
  (0 console-errors).
- Mock-flow ongewijzigd (koop → /bedankt).
- Mollie-adapter + webhook — 19 backend-tests (officiële Mollie Payments API v2).
- Hele repo groen: typecheck 0, **api 316 tests**, builds api+admin+storefront OK.

De enige stap die een sleutel vereist is de echte Mollie-API-call zelf — dat is stap 2–4
hierboven en duurt een paar minuten zodra je de key hebt.
