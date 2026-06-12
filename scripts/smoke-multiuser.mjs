// scripts/smoke-multiuser.mjs — end-to-end multi-user smoke tegen de LIVE API (:7300).
// Bewijst: registratie → eigen shop → koppel-token → eigen product → storefront,
// plus ISOLATIE (tenant ziet géén operator-data, admin-only modules → 403) en
// dat de admin geconsolideerd alles blijft zien.
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:7300';
const log = (...a) => console.log(...a);
let fails = 0;

function jar() {
  let cookie = '';
  return {
    async call(method, path, { body, headers = {}, expect } = {}) {
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
      if (!ok) { fails++; log(`XX  ${method} ${path} -> ${res.status}  ${String(text).slice(0, 160)}`); }
      else log(`OK  ${method} ${path} -> ${res.status}`);
      return { status: res.status, data };
    },
  };
}

function check(cond, label) {
  if (cond) log(`  E-OK  ${label}`);
  else { fails++; log(`  E-XX  ${label}`); }
}

async function main() {
  const admin = jar();
  const tenant = jar();
  const stamp = Date.now().toString(36);
  const email = `tenant-${stamp}@smoke.local`;

  // ── 1. registratie + auto-login ─────────────────────────────
  const reg = await tenant.call('POST', '/api/auth/register', {
    body: { email, password: 'tenantpass123' }, expect: [201],
  });
  check(reg.data?.user?.role === 'user', `register → role 'user' (${email})`);

  // ── 2. lege wereld voor verse tenant ────────────────────────
  const shops0 = await tenant.call('GET', '/api/shops', { expect: [200] });
  const shopList0 = shops0.data?.items ?? shops0.data?.shops ?? shops0.data ?? [];
  check(Array.isArray(shopList0) && shopList0.length === 0, 'tenant ziet 0 shops bij start');
  const prod0 = await tenant.call('GET', '/api/products?limit=5', { expect: [200] });
  const prodList0 = prod0.data?.items ?? prod0.data?.products ?? [];
  check(prodList0.length === 0, 'tenant ziet 0 producten (platform-catalogus onzichtbaar)');
  const ord0 = await tenant.call('GET', '/api/orders', { expect: [200] });
  const ordList0 = ord0.data?.items ?? ord0.data?.orders ?? [];
  check(ordList0.length === 0, 'tenant ziet 0 orders');

  // ── 3. admin-only modules → 403 ─────────────────────────────
  for (const p of ['/api/finance/pnl', '/api/channels', '/api/admin/users', '/api/locations', '/api/analytics/summary', '/api/audit']) {
    const r = await tenant.call('GET', p, { expect: [403] });
    check(r.status === 403, `admin-only ${p} → 403`);
  }

  // ── 4. eigen shop aanmaken → owner-membership ───────────────
  const mk = await tenant.call('POST', '/api/shops', {
    body: { slug: `tenant-${stamp}`, name: 'Tenant Testshop' }, expect: [200, 201],
  });
  const shopId = mk.data?.shop?.id ?? mk.data?.id;
  check(Boolean(shopId), `shop aangemaakt (${shopId})`);
  const members = await tenant.call('GET', `/api/shops/${shopId}/members`, { expect: [200] });
  const memberList = members.data?.items ?? members.data?.members ?? members.data ?? [];
  check(memberList.some((m) => m.email === email && m.role === 'owner'), 'aanmaker is owner-member');

  // ── 5. last-owner-guard ─────────────────────────────────────
  const self = memberList.find((m) => m.email === email);
  if (self) {
    const del = await tenant.call('DELETE', `/api/shops/${shopId}/members/${self.id}`, { expect: [409] });
    check(del.status === 409, 'laatste owner kan zichzelf niet verwijderen (409)');
  }

  // ── 6. koppel-token + headless storefront ───────────────────
  const tok = await tenant.call('POST', `/api/shops/${shopId}/storefront-token`, { expect: [200, 201] });
  const rawToken = tok.data?.token ?? tok.data?.storefrontToken;
  check(Boolean(rawToken), 'storefront-token ontvangen (raw, 1x)');
  const sf = await fetch(`${BASE}/api/storefront/v1/products`, { headers: { 'X-Storefront-Token': rawToken } });
  check(sf.status === 200, `storefront via token → ${sf.status}`);

  // ── 7. eigen product → publiceren → zichtbaar op storefront ─
  const np = await tenant.call('POST', '/api/products', {
    body: { title: 'Tenant Product', status: 'active', variants: [] },
    expect: [200, 201],
  });
  const productId = np.data?.product?.id ?? np.data?.id;
  check(Boolean(productId), `eigen product aangemaakt (${productId})`);
  await tenant.call('PUT', `/api/shops/${shopId}/products/${productId}`, {
    body: { published: true }, expect: [200, 201],
  });
  const sf2 = await fetch(`${BASE}/api/storefront/v1/products`, { headers: { 'X-Storefront-Token': rawToken } });
  const sfData = await sf2.json().catch(() => ({}));
  const sfItems = sfData?.items ?? sfData?.products ?? [];
  check(sfItems.some((p) => p.title === 'Tenant Product'), 'gepubliceerd product zichtbaar op eigen storefront');

  // ── 8. isolatie tegen operator-data ─────────────────────────
  await admin.call('POST', '/api/auth/login', {
    body: { email: 'admin@webshop-crm.local', password: 'admin12345' }, expect: [200],
  });
  const adminShops = await admin.call('GET', '/api/shops?search=crema', { expect: [200] });
  const cremaId = (adminShops.data?.items ?? adminShops.data ?? []).find?.((s) => s.slug === 'crema')?.id;
  if (cremaId) {
    const r1 = await tenant.call('GET', `/api/shops/${cremaId}`, { expect: [404] });
    check(r1.status === 404, 'andermans shop-detail → 404');
    const r2 = await tenant.call('GET', `/api/orders?shop_id=${cremaId}`, { expect: [404] });
    check(r2.status === 404, 'orders-list met andermans shop-filter → 404');
  } else {
    log('  E-?? crema-shop niet gevonden (demo-seed ontbreekt?) — isolatie-checks deels overgeslagen');
  }
  const adminProd = await admin.call('GET', '/api/products?limit=1', { expect: [200] });
  const platformProductId = (adminProd.data?.items ?? [])[0]?.id;
  if (platformProductId && platformProductId !== productId) {
    const r3 = await tenant.call('GET', `/api/products/${platformProductId}`, { expect: [404] });
    check(r3.status === 404, 'platform-product voor tenant → 404');
  }

  // ── 9. admin ziet alles geconsolideerd ──────────────────────
  const allShops = await admin.call('GET', `/api/shops?search=tenant-${stamp}`, { expect: [200] });
  const found = (allShops.data?.items ?? allShops.data ?? []).some?.((s) => s.id === shopId);
  check(found, 'admin ziet de tenant-shop (geconsolideerd)');
  const tdetail = await admin.call('GET', `/api/products/${productId}`, { expect: [200] });
  check(tdetail.status === 200, 'admin ziet het tenant-product');

  log('');
  if (fails > 0) { log(`SMOKE_MULTIUSER_FAIL (${fails} fails)`); process.exit(1); }
  log('SMOKE_MULTIUSER_PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
