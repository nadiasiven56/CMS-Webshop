/**
 * CMS-router — `/api/cms/*`.
 *
 * Content-management per shop: pages (page-builder), herbruikbare blocks,
 * navigatie-menus (self-nesting items), blog, media-library en URL-redirects.
 *
 * Sub-routers (1 file per resource):
 *   /api/cms/pages       → pages.ts      (cms_pages)
 *   /api/cms/blocks      → blocks.ts     (cms_blocks)
 *   /api/cms/menus       → menus.ts      (cms_menus + cms_menu_items, nested)
 *   /api/cms/blog        → blog.ts       (blog_posts)
 *   /api/cms/media       → media.ts      (cms_media — shop_id nullable = globaal)
 *   /api/cms/redirects   → redirects.ts  (cms_redirects)
 *
 * Auth: ALLES achter `requireAuth` (admin-API). Shop-scoping per resource via
 * `?shop=<slug|id>` of `X-Shop-Id`-header (media mag globaal = zonder shop).
 *
 * Wired in routes/index.ts door de finalizer (zie REGISTER.md):
 *   apiRoutes.route('/cms', cmsRoutes);
 */
import { Hono } from 'hono';
import { requireAuth, type AuthVariables } from '../../middleware/auth.js';
import { pageRoutes } from './pages.js';
import { blockRoutes } from './blocks.js';
import { menuRoutes } from './menus.js';
import { blogRoutes } from './blog.js';
import { mediaRoutes } from './media.js';
import { redirectRoutes } from './redirects.js';

export const cmsRoutes = new Hono<{ Variables: AuthVariables }>();

// Admin-API: alles achter auth.
cmsRoutes.use('*', requireAuth);

cmsRoutes.route('/pages', pageRoutes);
cmsRoutes.route('/blocks', blockRoutes);
cmsRoutes.route('/menus', menuRoutes);
cmsRoutes.route('/blog', blogRoutes);
cmsRoutes.route('/media', mediaRoutes);
cmsRoutes.route('/redirects', redirectRoutes);
