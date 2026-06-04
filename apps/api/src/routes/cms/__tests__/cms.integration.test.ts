/**
 * CMS-router integratie-test tegen de ECHTE PostgreSQL (:7432, DB webshop_crm).
 *
 * Strategie (zoals WAVE1-BACKEND-CONTRACT vraagt):
 *   - Mock ALLEEN de auth-middleware zodat requests langs requireAuth komen
 *     met een vaste test-user (geen echte session-cookie nodig).
 *   - Gebruik de ECHTE `db` → echte tabellen cms_pages / cms_menus / etc.
 *   - Maak een wegwerp-shop, exerciseer pages + blocks + menus(+items) + blog +
 *     redirects + media-register, lees terug, en ruim alles op (DELETE shop →
 *     FK-cascade verwijdert alle CMS-kinderen).
 *
 * De test wordt geskipt als de DB niet bereikbaar is (CI zonder Postgres),
 * zodat `vitest run` niet hard faalt buiten de dev-omgeving.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ─── Mock auth: altijd een geldige test-user ──────────────────────
vi.mock('../../../middleware/auth.js', () => ({
  requireAuth: async (c: any, next: any) => {
    c.set('user', {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'test@example.com',
      role: 'admin',
    });
    await next();
  },
}));

// ─── Late imports (na mock) ───────────────────────────────────────
let app: any;
let db: any;
let closeDb: () => Promise<void>;
let shops: any;
let dbAvailable = false;
let shopId = '';

async function buildApp() {
  const { Hono } = await import('hono');
  const { cmsRoutes } = await import('../index.js');
  const a = new Hono();
  a.route('/api/cms', cmsRoutes);
  return a;
}

beforeAll(async () => {
  const dbMod = await import('../../../lib/db.js');
  db = dbMod.db;
  closeDb = dbMod.closeDb;
  const schema = await import('../../../db/schema/index.js');
  shops = schema.shops;

  try {
    // Maak een wegwerp-shop. Slaagt dit, dan is de DB bereikbaar + gemigreerd.
    // (audit_log.actor_id is plain text → geen user-FK nodig.)
    const [shop] = await db
      .insert(shops)
      .values({
        slug: `cms-test-${Date.now()}`,
        name: 'CMS Test Shop',
      })
      .returning();
    shopId = shop.id;
    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[cms.integration] DB niet bereikbaar — test geskipt:', (err as Error).message);
    dbAvailable = false;
  }

  app = await buildApp();
}, 30_000);

afterAll(async () => {
  try {
    if (dbAvailable && shopId) {
      const { eq } = await import('drizzle-orm');
      // FK-cascade ruimt cms_pages/blocks/menus/menu_items/blog/redirects/media op.
      await db.delete(shops).where(eq(shops.id, shopId));
    }
  } finally {
    if (closeDb) await closeDb();
  }
});

describe('CMS integratie (echte DB)', () => {
  it('shop-scoping: GET zonder ?shop geeft 400 shop_required', async () => {
    if (!dbAvailable) return;
    const res = await app.request('/api/cms/pages');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('shop_required');
  });

  it('pages: create → read → patch → conflict → delete', async () => {
    if (!dbAvailable) return;

    // CREATE
    const createRes = await app.request('/api/cms/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shopId,
        title: 'Over Ons',
        blocks: [{ type: 'hero', heading: 'Welkom' }],
        seo: { title: 'Over Ons | Test' },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).page;
    expect(created.slug).toBe('over-ons');
    expect(created.shopId).toBe(shopId);
    expect(created.blocks).toHaveLength(1);
    const pageId = created.id;

    // READ list (shop-scoped)
    const listRes = await app.request(`/api/cms/pages?shop=${shopId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.items.some((p: any) => p.id === pageId)).toBe(true);

    // READ by id
    const getRes = await app.request(`/api/cms/pages/${pageId}?shop=${shopId}`);
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).page.title).toBe('Over Ons');

    // PATCH (status → published)
    const patchRes = await app.request(`/api/cms/pages/${pageId}?shop=${shopId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).page.status).toBe('published');

    // CONFLICT (zelfde slug binnen shop)
    const dupRes = await app.request('/api/cms/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId, title: 'Over Ons' }),
    });
    expect(dupRes.status).toBe(409);
    expect((await dupRes.json()).error).toBe('slug_conflict');

    // DELETE
    const delRes = await app.request(`/api/cms/pages/${pageId}?shop=${shopId}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).ok).toBe(true);

    // 404 na delete
    const gone = await app.request(`/api/cms/pages/${pageId}?shop=${shopId}`);
    expect(gone.status).toBe(404);
  });

  it('blocks: create + list shop-scoped', async () => {
    if (!dbAvailable) return;
    const res = await app.request('/api/cms/blocks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId, key: 'site-footer', type: 'richtext', content: { html: '<p>c</p>' } }),
    });
    expect(res.status).toBe(201);
    const block = (await res.json()).block;
    expect(block.key).toBe('site-footer');

    const listRes = await app.request(`/api/cms/blocks?shop=${shopId}`);
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).items.some((b: any) => b.id === block.id)).toBe(true);
  });

  it('menus: create menu + nested items, read tree, reorder via PUT', async () => {
    if (!dbAvailable) return;

    // menu
    const menuRes = await app.request('/api/cms/menus', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId, location: 'header', name: 'Hoofdmenu' }),
    });
    expect(menuRes.status).toBe(201);
    const menuId = (await menuRes.json()).menu.id;

    // parent item
    const parentRes = await app.request(`/api/cms/menus/${menuId}/items?shop=${shopId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Shop', url: '/shop', position: 0 }),
    });
    expect(parentRes.status).toBe(201);
    const parentId = (await parentRes.json()).item.id;

    // child item (nesting via parentId)
    const childRes = await app.request(`/api/cms/menus/${menuId}/items?shop=${shopId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Koffie', url: '/shop/koffie', parentId, position: 0 }),
    });
    expect(childRes.status).toBe(201);

    // read tree → parent met 1 child
    const treeRes = await app.request(`/api/cms/menus/${menuId}?shop=${shopId}`);
    expect(treeRes.status).toBe(200);
    const menu = (await treeRes.json()).menu;
    expect(menu.items).toHaveLength(1);
    expect(menu.items[0].id).toBe(parentId);
    expect(menu.items[0].children).toHaveLength(1);
    expect(menu.items[0].children[0].label).toBe('Koffie');

    // invalid parent (self) → 400
    const childId = menu.items[0].children[0].id;
    const selfRes = await app.request(`/api/cms/menus/${menuId}/items/${childId}?shop=${shopId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: childId }),
    });
    expect(selfRes.status).toBe(400);

    // bulk-replace via PUT (ref/parentRef nesting)
    const putRes = await app.request(`/api/cms/menus/${menuId}/items?shop=${shopId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { ref: 'a', label: 'Home', url: '/', position: 0 },
          { ref: 'b', label: 'Blog', url: '/blog', position: 1 },
          { parentRef: 'b', label: 'Nieuws', url: '/blog/nieuws', position: 0 },
        ],
      }),
    });
    expect(putRes.status).toBe(200);
    const tree = (await putRes.json()).items;
    expect(tree).toHaveLength(2);
    const blogNode = tree.find((n: any) => n.label === 'Blog');
    expect(blogNode.children).toHaveLength(1);
    expect(blogNode.children[0].label).toBe('Nieuws');
  });

  it('blog: create + tag-filter list', async () => {
    if (!dbAvailable) return;
    const res = await app.request('/api/cms/blog', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shopId,
        title: 'Eerste Post',
        bodyHtml: '<p>hi</p>',
        tags: ['nieuws', 'koffie'],
        status: 'published',
      }),
    });
    expect(res.status).toBe(201);
    const post = (await res.json()).post;
    expect(post.tags).toContain('koffie');

    const tagRes = await app.request(`/api/cms/blog?shop=${shopId}&tag=koffie`);
    expect(tagRes.status).toBe(200);
    expect((await tagRes.json()).items.some((p: any) => p.id === post.id)).toBe(true);

    const noTagRes = await app.request(`/api/cms/blog?shop=${shopId}&tag=bestaat-niet`);
    expect((await noTagRes.json()).items.some((p: any) => p.id === post.id)).toBe(false);
  });

  it('redirects: create + path-normalisatie + conflict', async () => {
    if (!dbAvailable) return;
    const res = await app.request('/api/cms/redirects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId, fromPath: 'oude-pagina/', toPath: '/nieuwe-pagina' }),
    });
    expect(res.status).toBe(201);
    const r = (await res.json()).redirect;
    expect(r.fromPath).toBe('/oude-pagina'); // leading slash + trailing strip
    expect(r.statusCode).toBe(301);

    const dup = await app.request('/api/cms/redirects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId, fromPath: '/oude-pagina', toPath: '/elders' }),
    });
    expect(dup.status).toBe(409);
  });

  it('media: register globaal (shop_id NULL) + list global scope', async () => {
    if (!dbAvailable) return;
    const res = await app.request('/api/cms/media', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://localhost:7300/storage/media/global/uploads/abc-logo.png',
        filename: 'logo.png',
        mime: 'image/png',
        folder: 'uploads',
      }),
    });
    expect(res.status).toBe(201);
    const media = (await res.json()).media;
    expect(media.shopId).toBeNull();

    const listRes = await app.request('/api/cms/media?scope=global');
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).items.some((m: any) => m.id === media.id)).toBe(true);

    // opruimen (media hangt NIET aan de shop want shop_id NULL → handmatig)
    const del = await app.request(`/api/cms/media/${media.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
  });

  it('unknown shop → 404 shop_not_found', async () => {
    if (!dbAvailable) return;
    const res = await app.request('/api/cms/pages?shop=bestaat-echt-niet-xyz');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('shop_not_found');
  });
});
