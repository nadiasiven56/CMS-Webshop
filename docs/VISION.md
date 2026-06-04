# Vision — Webshop-CRM

**Versie**: 0.1 (concept, wacht op operator-akkoord)
**Auteur**: Atlas (agent1)
**Datum**: 2026-05-09

## Probleem

Operator wil meerdere eigen webshops runnen + verkopen op marketplaces (Bol, Amazon, Google Shopping) **vanuit één plek en één magazijn**. Bestaande oplossingen (Shopify + Channable + Picqer + Moneybird) zijn duur (€200+/mnd ineens) én vendor-locked. Hij wil zelf eigenaar zijn van de catalogus, voorraad-bron, klanten-data en financiele logica — niet afhankelijk van Shopify-tenants of Channable-feeds-quota.

## Doel

Een custom, self-hosted **CRM/ERP-platform** dat fungeert als single source of truth voor:

1. **Catalogus** — producten + varianten + foto's + content, één keer beheerd, naar N kanalen gepushed
2. **Voorraad** — fysieke stock per locatie, reserveringen, inkoop-flow, audit-trail
3. **Orders** — uit alle kanalen ingelezen, gepicked, verstuurd, gefinancieerd
4. **Klanten** — cross-shop profielen, lifetime value (V2), e-mail-flows (V2)
5. **Financieel** — eigen ledger met winst/verlies per product/shop/kanaal + UBL-export naar boekhouder

Webshops zelf worden "domme" headless storefronts (Next.js per shop) die via REST-API uit deze CRM eten. Marketplaces (Bol/Amazon/GMC) zijn channel-adapters in dezelfde codebase.

## Kern-aannames

- **Greenfield**: alle webshops worden custom gebouwd — geen import vanuit WooCommerce/Shopify nodig.
- **Operator = enige user** in V1 (geen multi-tenant, geen klanten-van-klanten).
- **MKB-schaal start**: 1k-50k SKU's, ~100 orders/dag start, hoofdletter-OK tot 1000/dag.
- **NL-eerst**: BTW-regels, GS1-EAN, Bol-marketplace, Moneybird zijn de defaults. EU-cross-border via OSS in scope V1.
- **Eigen ledger** met UBL-export is de financiele backbone; Moneybird-koppeling is optionele adapter.
- **Adapter-architectuur** vanaf dag 1 voor channels, carriers en accounting — anders kunnen we niet èlle marketplaces ondersteunen.

## Niet-doelen V1 (expliciet uitgesloten)

| Niet | Waarom uitgesloten | Wanneer wel |
|---|---|---|
| Multi-tenant SaaS | Operator is enige user | Nooit (privé-platform) |
| B2B-portal / wholesale | Verschil in factuur-flow + BTW-verlegd te complex voor V1 | V2 als eigen kanaal |
| POS / kassasysteem | Geen winkel-fysiek-vraag | V2 als nodig |
| Mobile-app | Admin = responsive web V1 | V2 als nodig |
| AI-features in CRM zelf | AI Centrum is de external chat-tool | Nooit (separation of concerns) |
| Lot/serial-tracking | Niet nodig voor 80% MKB-cases | V2 |
| Repricer (concurrent-prijsmonitoring) | Channable/EffectConnect-domein | V2 |
| Multi-currency operatie | EUR is voldoende voor NL+EU + IOSS-flow | V2 als US-listings nodig |
| Forecast/replenishment ML | Geen data om op te trainen V1 | V3 |

## Success-criteria V1

V1 is "klaar" wanneer:

1. **Catalogus**: 1 product met 3 varianten + foto's kan via admin worden ingevoerd en is **simultaan zichtbaar** op:
   - 1 eigen webshop (Aether's template)
   - Google Shopping feed (XML, gevalideerd door GMC-diagnostics)
   - Bol-Offers (sandbox of live, EAN-correct)
2. **Voorraad**: een verkoop op één kanaal trekt voorraad af, blokkeert de andere kanalen voor dat aantal, en logt een movement.
3. **Order-flow**: Bol-order komt binnen via poll, wordt geallocateerd, label wordt gegenereerd via Sendcloud/MyParcel, tracking-update komt terug, order is `DELIVERED`.
4. **Financieel**: orders van 1 dag worden geaggregeerd naar 1 boeking per kanaal+BTW-tarief en zijn **exporteerbaar** als UBL én pushbaar naar Moneybird.
5. **BTW**: VIES-validatie werkt voor B2B-NL/EU, OSS-CSV-export per kwartaal opent in Mijn Belastingdienst.
6. **Operationeel**: alles draait lokaal op `hoi` met cloudflared-tunnel; auth werkt; audit-log compleet.

## Open vragen voor operator

Niet blokkerend voor V1-bouw, maar nodig voor scope-finalisatie:

1. **GS1-NL membership** al geregeld? Zo nee → moet vóór live-go-Bol/Amazon ingekocht (~€85/jr starter).
2. **Eigen-merk-producten** of enkel resale? Bepaalt of we GTIN-generation-tooling V1 nodig hebben.
3. **B2B-orders** verwacht in V1? Default: B2C-only, B2B-velden in schema maar geen UI-flow.
4. **Multi-currency** ooit nodig? Default V1: EUR-only.

## Atlas-defaults bij geen operator-input

- GS1: assumeren "nog niet geregeld" → membership-actie op pre-launch checklist.
- Eigen-merk: V1 ondersteunt EAN-input maar genereert niet zelf.
- B2B: schema-ready (BTW-nr-veld, factuur-flag), UI hidden achter feature-flag tot operator inschakelt.
- Multi-currency: hard-coded EUR V1; FX-tabel + currency-veld in schema voor V2.
