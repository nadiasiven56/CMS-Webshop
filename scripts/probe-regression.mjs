// scripts/probe-regression.mjs — Part 3 regression sweep (authenticated).
// Confirms core flows + 8 new-module GETs survived Round 3.
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:7300';
let cookie = '';
const log = (...a) => console.log(...a);
const out = [];

async function call(method, path, { body, headers = {}, auth = true } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (auth && cookie) h['cookie'] = cookie;
  const res = await fetch(BASE + path, {
    method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let data; const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function rec(label, status, ok, extra = '') {
  out.push({ label, status, ok });
  log(`${ok ? 'PASS' : 'FAIL'}  ${label} -> ${status}${extra ? '  ' + extra : ''}`);
}

async function main() {
  const login = await call('POST', '/api/auth/login', {
    body: { email: 'admin@webshop-crm.local', password: 'admin12345' }, auth: false,
  });
  rec('login', login.status, login.status === 200);

  // ── Products: list ──
  const plist = await call('GET', '/api/products?limit=5');
  const firstProd = plist.data?.items?.[0];
  rec('products list', plist.status, plist.status === 200, `count=${plist.data?.items?.length ?? '?'}`);

  // ── Products: single GET ──
  let prod = null;
  if (firstProd?.id) {
    const pget = await call('GET', `/api/products/${firstProd.id}`);
    prod = pget.data?.product;
    rec('product GET (single)', pget.status, pget.status === 200, `id=${firstProd.id}`);
  } else {
    rec('product GET (single)', 0, false, 'no product to fetch');
  }

  // ── Products: PATCH (edit) — flip a benign field & restore ──
  if (prod?.id) {
    const origVendor = prod.vendor ?? null;
    const probeVendor = `qa-probe-${Date.now()}`;
    const patch1 = await call('PATCH', `/api/products/${prod.id}`, { body: { vendor: probeVendor } });
    const applied = patch1.data?.product?.vendor === probeVendor;
    rec('product PATCH (edit)', patch1.status, patch1.status === 200 && applied,
      `vendor "${origVendor}"->"${probeVendor}" applied=${applied}`);
    // restore
    await call('PATCH', `/api/products/${prod.id}`, { body: { vendor: origVendor } });
  } else {
    rec('product PATCH (edit)', 0, false, 'no product to edit');
  }

  // ── Orders: list ──
  const olist = await call('GET', '/api/orders?limit=5');
  rec('orders list', olist.status, olist.status === 200, `count=${olist.data?.items?.length ?? '?'}`);

  // ── Channels: list + own_webshop sync ──
  const chlist = await call('GET', '/api/channels');
  rec('channels list', chlist.status, chlist.status === 200);
  const own = (chlist.data?.items ?? []).find((c) => c.type === 'own_webshop');
  if (own?.id) {
    const sync = await call('POST', `/api/channels/${own.id}/sync`, { body: {} });
    rec('POST channels/:id/sync (own_webshop)', sync.status, sync.status === 200,
      `imported=${JSON.stringify(sync.data?.imported ?? sync.data?.result ?? sync.data ?? '').slice(0,120)}`);
  } else {
    rec('POST channels/:id/sync (own_webshop)', 0, false, 'no own_webshop channel');
  }

  // ── 8 new-module GETs ──
  const shopId = own?.config?.shopSlug ? null : null; // feeds needs a real shop_id
  // get a shop id for feeds
  const shops = await call('GET', '/api/shops?limit=1');
  const anyShopId = shops.data?.items?.[0]?.id;

  const modules = [
    ['GET /api/discounts', '/api/discounts'],
    ['GET /api/shipping/carriers', '/api/shipping/carriers'],
    ['GET /api/accounting/connections', '/api/accounting/connections'],
    ['GET /api/notifications/providers', '/api/notifications/providers'],
    ['GET /api/reviews/sources', '/api/reviews/sources'],
    ['GET /api/feeds/configs', `/api/feeds/configs${anyShopId ? `?shop_id=${anyShopId}` : ''}`],
    ['GET /api/analytics/kpis', '/api/analytics/kpis'],
    ['GET /api/webhooks/events', '/api/webhooks/events'],
    ['GET /api/audit', '/api/audit'],
  ];
  for (const [label, path] of modules) {
    const r = await call('GET', path);
    rec(label, r.status, r.status === 200);
  }

  const fails = out.filter((o) => !o.ok);
  log(`\n${fails.length === 0 ? 'REGRESSION_PASS' : `REGRESSION_FAIL (${fails.length})`} — ${out.length - fails.length}/${out.length} probes ok`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('probe crashed', e); process.exit(1); });
