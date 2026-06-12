# Webshop-CRM — Oordeel & Roadmap

> 2026-06-10, Atlas. Eerlijke stand van zaken na een live audit (echte browser + API-smoke +
> code-review) en de fixes van vandaag. Bedoeld om te beslissen wat we hierna bouwen.

---

## 1. Antwoord op je belangrijkste vraag

> *"Hoe kan het dat je het op de achtergrond test, maar dat het in de praktijk toch niet werkt?"*

Omdat de achtergrond-tests (unit/integratie) tegen een **eigen, schone test-database** draaien. Ze
zeggen "de code klopt", maar **niet** "jouw live-systeem draait". Vandaag bleek je **dev-database
helemaal plat te liggen** (de `.pgdata`-map was corrupt — vrijwel zeker beschadigd toen `.pgdata`
ooit uit git is gehaald). Daardoor faalde élke actie (inclusief inloggen) met een 500, terwijl de
tests groen bleven en `/health` "OK" zei.

**Structureel opgelost / afgesproken:**
1. Gebruik **`/health/ready`** (raakt de DB) i.p.v. `/health` (alleen API-leven) om "werkt het écht" te checken.
2. **`node scripts/smoke-api.mjs`** test de hele keten tegen de *live* stack — dit had de storing meteen gevangen. Aanrader: dit periodiek/als hook draaien (zie roadmap).
3. Alle fixes van vandaag zijn **in de echte browser tegen de live stack** geverifieerd, niet alleen met unit-tests.

---

## 2. Wat is vandaag gefixt (en bewezen)

| # | Probleem | Fix | Bewijs |
|---|---|---|---|
| 1 | **Dev-DB lag plat** → inloggen/alles faalde | Corrupt `.pgdata` veiliggesteld (`.pgdata.broken-…`), verse cluster + migrate/seed | login → 200; `/health/ready` ok; smoke `SMOKE_PASS` |
| 2 | **Nieuw product → geen voorraad-rij** → "voorraad niet aanpasbaar" | `products/create.ts` maakt nu per variant een `inventory_item` + begin-level op de hoofd-locatie | E2E in echte browser: nieuw product → Voorraad → +7 → on-hand 7 ✅ |
| 3 | `/api/finance/pnl` negeerde de `channel`-filter | `channel` toegevoegd aan schema + query | typecheck 0 fouten |

Verder bevestigd in de live-audit: **alle 15 admin-pagina's laden zonder fouten**, CRUD/edit-drawers
werken (PATCH 200), en de **headless koppeling werkt** (token → producten + pagina's + blog + menu's).

---

## 3. Wat werkt nu goed

- **Commerce-kern:** producten, varianten, voorraad (na fix), orders, klanten, retouren, checkout, betaalde orders, dubbel-boekhouden grootboek (gebalanceerd).
- **Multi-shop:** meerdere winkels in één systeem, winkelkeuze, per-shop scoping.
- **Headless content:** CMS-pagina's, blog, menu's, media — opvraagbaar door elke gekoppelde frontend.
- **Koppeling:** publishable token (`wcrm_pk_`) + SDK → een externe site laadt producten én content. Snel, want de frontend rendert zelf.
- **Admin-UX:** rijk menu, edit-drawers, command-palette, bulk-acties, toegankelijkheid.

---

## 4. Wat mist of beter kan (eerlijk, geprioriteerd)

**GAP #1 — Geconsolideerde omzet over álle accounts (jouw kernwens).**
Bol/Amazon-orders worden bij sync in een staging-tabel (`channel_orders`) gezet, maar **niet als
volwaardige `orders` gematerialiseerd**. Gevolg: "totale omzet alles bij elkaar" telt nu vooral
web-omzet; Bol/Amazon tellen nog niet mee. Dit is nodig om écht "alle sites + Amazon + Bol bij elkaar"
te zien, inclusief openstaande orders per kanaal. → **Roadmap fase 2.**

**GAP #2 — Live marktplaats/betaal-koppelingen.**
Bol, Amazon en Mollie zijn *koppel-klaar* maar niet live (vereisen jouw echte API-sleutels). Pas dan
komt er echte data binnen. → **Roadmap fase 3.**

**GAP #3 — Bewaking ("monitoring").**
Niets waarschuwt je als de DB/stack omvalt (dat was nu juist het probleem). Een kleine
"draait-alles-nog"-check zou dit vroeg vangen. → **Roadmap fase 2 (klein).**

**GAP #4 — Echte externe frontend nog niet end-to-end gekoppeld.**
De koppeling is technisch bewezen, maar de site van je vriendin is nog niet daadwerkelijk
aangesloten. Dat is vooral configuratie + (waarschijnlijk) een paar veld-mappings. → **Roadmap fase 2.**

**Kleine punten (niet blokkerend):**
- CMS: `publishedAt` wordt niet automatisch gezet bij publiceren; geen integriteitscheck op media-referenties.
- Login rate-limit (10/15min) kan tijdens intensief testen 429 geven — gedrag is correct, goed om te weten.

---

## 5. Wat is misschien "teveel" / let op

De repo bevat veel modules die **koppel-klaar maar ongebruikt** zijn: reviews (Kiyoh/Trustpilot/Google),
verzending (PostNL/MyParcel/Sendcloud), boekhoud-sync (Exact/Moneybird/e-Boekhouden), e-mail-providers,
webhooks, programmatic discounts. Dat is veel oppervlak om te onderhouden terwijl je het (nog) niet
gebruikt. **Advies:** focus op de keten die je écht gebruikt (eigen webshop + voorraad + orders +
geconsolideerde omzet) en activeer de rest pas wanneer je het nodig hebt. Niet weggooien — wel
bewust "uit" laten staan zodat het je niet afleidt.

---

## 6. Roadmap (realistische volgorde)

**✅ Fase 1 — Kern werkend (KLAAR, vandaag).**
DB hersteld, voorraad-bug gefixt, koppeling + admin bewezen in de echte UI.

**Fase 2 — "Alles bij elkaar zien" + eerste echte koppeling (grootste waarde).**
- Bol/Amazon-sync → orders **materialiseren** als CRM-orders, zodat omzet/openstaande orders cross-account kloppen (GAP #1).
- De site van je vriendin **echt koppelen** (token + SDK + veld-mapping), end-to-end testen (GAP #4).
- Kleine **monitoring-check** (smoke periodiek draaien + seinen bij falen) (GAP #3).

**Fase 3 — Live externe koppelingen.**
Jouw echte sleutels invullen: Bol, Amazon, Mollie → live data en betalingen.

**Fase 4 — Marketing-data inlezen (lezen, niet sturen).**
- **Google Merchant Center**: productfeed valideren/publiceren (basis is al aanwezig).
- **Analytics (GA4)**: bezoekers/conversie naast je omzet.

**Fase 5 — Advertising-koppelingen.**
- **Google Ads** + **Facebook/Meta Ads**: eerst *lezen* (uitgaven, ROAS, per kanaal naast je omzet),
  later eventueel *sturen* (budget/campagnes). Begin met read-only; dat geeft 80% van de waarde tegen 20% risico.

**Fase 6 — AI-adviseur.**
Bovenop de dan geconsolideerde data (omzet + voorraad + ads + analytics): een assistent die concrete
adviezen geeft ("product X bijna uitverkocht en loopt goed → bijbestellen", "kanaal Y kost meer dan
het oplevert"). Dit werkt pas goed als fase 2–5 de data echt met elkaar laten praten — vandaar deze volgorde.

> **Rode draad:** eerst de data écht laten kloppen en samenkomen (fase 2), dan externe bronnen
> aansluiten (3–5), dan pas de AI erbovenop (6). Een AI-adviseur op incomplete data geeft verkeerde adviezen.

---

## 7. Aanbevolen volgende stap

Begin met **Fase 2**: de cross-account omzet-consolidatie + jouw vriendin's site echt aankoppelen.
Dat lost je twee concrete wensen op ("alles bij elkaar zien" en "elke frontend kunnen koppelen") en is
een afgebakende klus. Zeg het maar, dan pak ik die als volgende op.
