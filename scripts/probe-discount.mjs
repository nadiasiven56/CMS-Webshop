// scripts/probe-discount.mjs — verifieert de OPTIONELE discount-tak in checkout.
// 3 probes: (1) geldige code WELKOM10 → korting + redemption, (2) bogus code → 400,
// (3) geen code → ongewijzigd. Gebruikt unieke e-mails om per-klant-limieten te mijden.
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:7300';
const SHOP = 'crema';
let cookie = '';
const log = (...a) => console.log(...a);

async function call(method, path, { body, headers = {}, auth = false } = {}) {
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

async function login() {
  await call('POST', '/api/auth/login', { body: { email: 'admin@webshop-crm.local', password: 'admin12345' } });
}

async function freshCartWithItem() {
  const cart = await call('POST', `/api/storefront/v1/cart?shop=${SHOP}`);
  const token = cart.data?.cart?.token;
  // kies een gepubliceerde variant met voorraad
  const list = await call('GET', `/api/storefront/v1/products?shop=${SHOP}`);
  const items = list.data?.items ?? [];
  let variantId = null;
  for (const p of items.slice(0, 15)) {
    const det = await call('GET', `/api/storefront/v1/products/${p.slug}?shop=${SHOP}`);
    const v = (det.data?.product?.variants ?? []).find((vv) => (vv.available ?? 0) > 0);
    if (v) { variantId = v.id; break; }
  }
  await call('POST', `/api/storefront/v1/cart/${token}/items?shop=${SHOP}`, { body: { variantId, quantity: 2 } });
  return token;
}

const addr = { name: 'Probe Tester', line1: 'Teststraat 1', postcode: '1011AA', city: 'Amsterdam', country: 'NL' };

async function checkout(token, email, extra = {}) {
  return call('POST', `/api/storefront/v1/cart/${token}/checkout?shop=${SHOP}`, {
    body: { email, shippingAddress: addr, ...extra },
  });
}

async function redemptionsFor(orderId) {
  // admin-route bestaat niet voor redemptions; check via discounts list times_redeemed delta is lastig.
  // We bevestigen indirect: order.discountTotal > 0 + grandTotal verlaagd.
  return orderId;
}

async function main() {
  await login();
  const stamp = Date.now();

  // ── PROBE 1: geldige code WELKOM10 (10%) ──
  {
    const token = await freshCartWithItem();
    // baseline (zonder code) op identieke cart kunnen we niet hergebruiken (cart wordt geleegd),
    // dus we lezen subtotal/discount uit de order zelf.
    const co = await checkout(token, `probe1+${stamp}@test.local`, { discountCode: 'WELKOM10' });
    const o = co.data?.order;
    const sub = Number(o?.subtotal ?? 0);
    const disc = Number(o?.discountTotal ?? 0);
    const grand = Number(o?.grandTotal ?? 0);
    const ship = Number(o?.shippingTotal ?? 0);
    const expectDisc = Math.round(sub * 10) / 100; // 10%
    const ok = co.status === 201 && disc > 0
      && Math.abs(disc - expectDisc) < 0.01
      && Math.abs(grand - (sub + ship - disc)) < 0.01;
    log(`PROBE1 valid WELKOM10: status=${co.status} subtotal=${sub} discountTotal=${disc} (verwacht~${expectDisc}) grandTotal=${grand} ship=${ship} => ${ok ? 'PASS' : 'FAIL'}`);
  }

  // ── PROBE 2: bogus code → 400, geen order ──
  {
    const token = await freshCartWithItem();
    const co = await checkout(token, `probe2+${stamp}@test.local`, { discountCode: 'NONSENSE-XYZ-999' });
    const ok = co.status === 400 && co.data?.error === 'invalid_discount' && !!co.data?.reason && !co.data?.order;
    log(`PROBE2 bogus code: status=${co.status} error=${co.data?.error} reason=${co.data?.reason} => ${ok ? 'PASS' : 'FAIL'}`);
  }

  // ── PROBE 3: geen code → ongewijzigd (discountTotal 0, grand = sub+ship) ──
  {
    const token = await freshCartWithItem();
    const co = await checkout(token, `probe3+${stamp}@test.local`);
    const o = co.data?.order;
    const sub = Number(o?.subtotal ?? 0);
    const disc = Number(o?.discountTotal ?? 0);
    const grand = Number(o?.grandTotal ?? 0);
    const ship = Number(o?.shippingTotal ?? 0);
    const ok = co.status === 201 && disc === 0 && Math.abs(grand - (sub + ship)) < 0.01;
    log(`PROBE3 no code: status=${co.status} subtotal=${sub} discountTotal=${disc} grandTotal=${grand} ship=${ship} => ${ok ? 'PASS' : 'FAIL'}`);
  }
}

main().catch((e) => { console.error('probe crashed', e); process.exit(1); });
