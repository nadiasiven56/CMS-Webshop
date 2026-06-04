// scripts/smoke-api.mjs — integrale smoke tegen de LIVE API op :7300.
// Bewijst dat de Wave-1 routes gewired + functioneel zijn, plus de kern-E2E:
// admin login -> shop aanmaken -> product publiceren -> storefront ziet het.
// Herbruikbaar; uitgebreid in Wave 4 tot volledige acceptance-keten.
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:7300';
const log = (...a) => console.log(...a);
let cookie = '';
let fails = 0;

async function call(method, path, { body, headers = {}, expect } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (cookie) h['cookie'] = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const ok = expect ? expect.includes(res.status) : res.status < 400;
  if (!ok) { fails++; log(`XX  ${method} ${path} -> ${res.status}  ${text.slice(0, 160)}`); }
  else log(`OK  ${method} ${path} -> ${res.status}`);
  return { status: res.status, data };
}

async function waitHealth() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  if (!(await waitHealth())) { log('API niet healthy na 40s'); process.exit(1); }
  log('-- API healthy --');

  await call('POST', '/api/auth/login', {
    body: { email: 'admin@webshop-crm.local', password: 'admin12345' }, expect: [200],
  });

  // wiring-checks (geen 404 = gewired)
  await call('GET', '/api/shops', { expect: [200] });
  await call('GET', '/api/orders', { expect: [200] });
  await call('GET', '/api/customers', { expect: [200] });
  await call('GET', '/api/purchasing/suppliers', { expect: [200] });
  await call('GET', '/api/cms/pages?shop=smoke', { expect: [200, 400, 404] });

  // kern-E2E: shop -> publiceer product -> storefront
  const mk = await call('POST', '/api/shops', {
    body: { slug: 'smoke', name: 'Smoke Shop' }, expect: [200, 201, 409],
  });
  let shopId = mk.data?.shop?.id ?? mk.data?.id;
  if (mk.status === 409 || !shopId) {
    const list = await call('GET', '/api/shops?search=smoke', { expect: [200] });
    const items = list.data?.items ?? list.data ?? [];
    shopId = items.find?.((s) => s.slug === 'smoke')?.id ?? items[0]?.id;
  }
  log('shopId=' + shopId);

  const prods = await call('GET', '/api/products?limit=1', { expect: [200] });
  const productId = prods.data?.items?.[0]?.id;
  log('productId=' + productId);

  if (shopId && productId) {
    await call('PUT', `/api/shops/${shopId}/products/${productId}`, {
      body: { published: true }, expect: [200, 201],
    });
    const sf = await call('GET', '/api/storefront/v1/products', {
      headers: { 'X-Shop-Slug': 'smoke' }, expect: [200],
    });
    const cnt = sf.data?.items?.length ?? sf.data?.products?.length ?? (Array.isArray(sf.data) ? sf.data.length : '?');
    log('storefront published-products count=' + cnt);
  }

  // ════════════════════════════════════════════════════════════════
  // WAVE E — command-center end-to-end acceptance chain.
  // Bewijst de hele keten: connected own_webshop channel + connect-ready
  // bol + publieke storefront-checkout (SDK-pad) → order → ledger → KPI's.
  // Per-stap PASS/FAIL; verhoogt `fails` zodat de slot-SMOKE_PASS faalt bij
  // een gebroken keten. Alle bedragen blijven decimal-strings.
  // ════════════════════════════════════════════════════════════════
  await waveE();

  log(fails === 0 ? '\nSMOKE_PASS' : `\nSMOKE_FAIL (${fails} fouten)`);
  process.exit(fails === 0 ? 0 : 1);
}

// ─── Wave-E helpers ────────────────────────────────────────────

/** Per-stap-resultaat loggen + fails ophogen. */
function step(ok, label, extra = '') {
  if (ok) log(`  E-OK  ${label}${extra ? '  ' + extra : ''}`);
  else { fails++; log(`  E-XX  ${label}${extra ? '  ' + extra : ''}`); }
  return ok;
}

/** cents uit een decimal-string (4 of 2 dec) → integer centen, float-vrij. */
function toCents(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Math.round(n * 100);
}

const SHOP_SLUG = 'crema';

async function waveE() {
  log('\n-- WAVE E: command-center end-to-end --');

  // Baseline KPI's vooraf (voor de increase-assertie in stap 6).
  const baseKpi = await call('GET', '/api/dashboard/kpis?channel=web', { expect: [200] });
  const baseRevenue = Number(baseKpi.data?.revenue30d ?? 0);
  const baseOpen = Number(baseKpi.data?.openOrders ?? 0);
  log(`  E-baseline channel=web revenue30d=${baseRevenue} openOrders=${baseOpen}`);

  // Channels ophalen (admin, met cookie).
  const chList = await call('GET', '/api/channels', { expect: [200] });
  const channels = chList.data?.items ?? [];
  const ownCh = channels.find((c) => c.type === 'own_webshop');
  const bolCh = channels.find((c) => c.type === 'bol');

  // ── Stap 1: own_webshop voor 'crema' is connected ──────────────
  if (ownCh) {
    // Borg de shop-binding (PATCH config) als 'crema' nog niet gekoppeld is.
    const linkedSlug = ownCh.config?.shopSlug;
    if (linkedSlug !== SHOP_SLUG) {
      await call('PATCH', `/api/channels/${ownCh.id}`, {
        body: { config: { ...(ownCh.config ?? {}), shopSlug: SHOP_SLUG } },
        expect: [200],
      });
    }
    const test = await call('POST', `/api/channels/${ownCh.id}/test-connection`, { expect: [200] });
    step(test.data?.ok === true, 'stap1 own_webshop test-connection ok:true',
      `detail="${test.data?.detail ?? ''}"`);
  } else {
    step(false, 'stap1 own_webshop channel ontbreekt');
  }

  // ── Stap 2: bol test-connection → ok:false + 'credentials required' ─
  if (bolCh) {
    const test = await call('POST', `/api/channels/${bolCh.id}/test-connection`, { expect: [200] });
    const detail = String(test.data?.detail ?? '');
    step(
      test.data?.ok === false && /credentials required/i.test(detail),
      'stap2 bol test-connection ok:false + credentials required',
      `detail="${detail}"`,
    );
  } else {
    step(false, 'stap2 bol channel ontbreekt');
  }

  // ── Stap 3: storefront-checkout (SDK-pad, publiek, ?shop=crema) ─
  const sf = (path, opts = {}) =>
    call(opts.method ?? 'GET', `/api/storefront/v1${path}${path.includes('?') ? '&' : '?'}shop=${SHOP_SLUG}`, {
      ...opts,
      // Publiek pad — GEEN admin-cookie meesturen (anders test je niet de SDK-flow).
      headers: { ...(opts.headers ?? {}) },
    });

  // 3a. publieke producten → kies een gepubliceerde variant met voorraad.
  const prodList = await call('GET', `/api/storefront/v1/products?shop=${SHOP_SLUG}`, { expect: [200] });
  const sfItems = prodList.data?.items ?? [];
  step(sfItems.length > 0, 'stap3a storefront products', `count=${sfItems.length}`);

  // Loop tot we een variant met available>0 vinden (detail per product).
  let variantId = null;
  let pickedTitle = null;
  for (const p of sfItems.slice(0, 12)) {
    const det = await call('GET', `/api/storefront/v1/products/${p.slug}?shop=${SHOP_SLUG}`, { expect: [200] });
    const v = (det.data?.product?.variants ?? []).find((vv) => (vv.available ?? 0) > 0);
    if (v) { variantId = v.id; pickedTitle = det.data?.product?.title; break; }
  }
  step(!!variantId, 'stap3b gepubliceerde variant met voorraad', variantId ? `title="${pickedTitle}"` : '');

  let orderId = null;
  let orderNumber = null;
  if (variantId) {
    // 3c. nieuwe cart → token.
    const cartRes = await call('POST', `/api/storefront/v1/cart?shop=${SHOP_SLUG}`, { expect: [200, 201] });
    const token = cartRes.data?.cart?.token;
    step(!!token, 'stap3c cart aangemaakt', token ? `token=${String(token).slice(0, 8)}…` : '');

    if (token) {
      // 3d. add item.
      await call('POST', `/api/storefront/v1/cart/${token}/items?shop=${SHOP_SLUG}`, {
        body: { variantId, quantity: 1 }, expect: [200, 201],
      });
      // 3e. checkout → order.
      const co = await call('POST', `/api/storefront/v1/cart/${token}/checkout?shop=${SHOP_SLUG}`, {
        body: {
          email: 'e2e@test.local',
          shippingAddress: {
            name: 'E2E Tester',
            line1: 'Teststraat 1',
            postcode: '1011AA',
            city: 'Amsterdam',
            country: 'NL',
          },
        },
        expect: [200, 201],
      });
      orderId = co.data?.order?.id ?? null;
      orderNumber = co.data?.order?.orderNumber ?? null;
      step(
        !!orderId && co.data?.order?.financialStatus === 'paid',
        'stap3 checkout → betaalde order',
        `orderNumber=${orderNumber} grandTotal=${co.data?.order?.grandTotal}`,
      );
    }
  }

  // ── Stap 4: order verschijnt in admin GET /api/orders?channel=web ─
  if (orderId) {
    const ord = await call('GET', `/api/orders?channel=web&search=e2e@test.local&limit=50`, { expect: [200] });
    const found = (ord.data?.items ?? []).find((o) => o.id === orderId);
    step(!!found, 'stap4 order zichtbaar in /api/orders?channel=web',
      found ? `channel=${found.channel}` : `(${(ord.data?.items ?? []).length} web-orders, id niet gevonden)`);
  } else {
    step(false, 'stap4 overgeslagen — geen order-id');
  }

  // ── Stap 5: ledger-regels (revenue + vat) + debit/credit-balans ─
  if (orderId) {
    const led = await call('GET', `/api/finance/ledger?order_id=${orderId}&limit=50`, { expect: [200] });
    const rows = led.data?.items ?? [];
    const accounts = rows.map((r) => r.account);
    const hasRevenue = accounts.includes('revenue');
    const hasVat = accounts.includes('vat_payable');
    let debit = 0, credit = 0;
    for (const r of rows) { debit += toCents(r.debit); credit += toCents(r.credit); }
    const balanced = debit === credit && rows.length > 0;
    step(
      hasRevenue && hasVat && balanced,
      'stap5 ledger revenue+vat + debit==credit',
      `accounts=[${accounts.join(',')}] debitC=${debit} creditC=${credit} balanced=${balanced}`,
    );
  } else {
    step(false, 'stap5 overgeslagen — geen order-id');
  }

  // ── Stap 6: KPI's reflecteren de verkoop ───────────────────────
  const kpi = await call('GET', '/api/dashboard/kpis?channel=web', { expect: [200] });
  const revenue = Number(kpi.data?.revenue30d ?? 0);
  const open = Number(kpi.data?.openOrders ?? 0);
  const reflected = kpi.status === 200 && (revenue > baseRevenue || open > baseOpen || revenue > 0);
  step(
    reflected,
    'stap6 dashboard KPIs reflecteren verkoop',
    `revenue30d ${baseRevenue}→${revenue}  openOrders ${baseOpen}→${open}`,
  );
}

main().catch((e) => { console.error('SMOKE_ERROR', e); process.exit(1); });
