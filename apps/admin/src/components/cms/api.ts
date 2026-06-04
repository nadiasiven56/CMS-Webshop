/**
 * React-Query hooks voor de CMS-module (pages/blog/menus/media).
 *
 * Alle resources zijn shop-scoped: `activeShopId` zit in elke queryKey én gaat
 * als `?shop=` mee (en bij writes als `shopId` in de body). Endpoints + shapes:
 * zie `apps/api/src/routes/cms/REGISTER.md` + `_serialize.ts`.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  BlogPostDto,
  CmsMediaDto,
  CmsMenuDto,
  CmsMenuItemDto,
  CmsPageDto,
  ListResponse,
  PageBlock,
  SeoFields,
} from './types';

const shopParams = (shopId: string | null) => ({ shop: shopId ?? undefined });

// ════════════════════════════════════════════════════════════════
//  PAGES
// ════════════════════════════════════════════════════════════════
export interface PageListParams {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function usePages(shopId: string | null, params: PageListParams) {
  return useQuery({
    queryKey: ['cms', 'pages', shopId, params],
    queryFn: async (): Promise<ListResponse<CmsPageDto>> =>
      (
        await api.get('/cms/pages', {
          params: { ...shopParams(shopId), ...params },
        })
      ).data,
    enabled: !!shopId,
    placeholderData: keepPreviousData,
  });
}

export interface PageInput {
  title: string;
  slug?: string;
  status: string;
  template?: string;
  blocks: PageBlock[];
  seo: SeoFields;
}

export function useCreatePage(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PageInput): Promise<CmsPageDto> =>
      (
        await api.post(
          '/cms/pages',
          { ...input, shopId: shopId ?? undefined },
          { params: shopParams(shopId) },
        )
      ).data.page,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cms', 'pages', shopId] }),
  });
}

export function useUpdatePage(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<PageInput> }): Promise<CmsPageDto> =>
      (
        await api.patch(`/cms/pages/${vars.id}`, vars.patch, {
          params: shopParams(shopId),
        })
      ).data.page,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cms', 'pages', shopId] }),
  });
}

export function useDeletePage(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/cms/pages/${id}`, { params: shopParams(shopId) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cms', 'pages', shopId] }),
  });
}

// ════════════════════════════════════════════════════════════════
//  BLOG
// ════════════════════════════════════════════════════════════════
export interface BlogListParams {
  status?: string;
  tag?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useBlogPosts(shopId: string | null, params: BlogListParams) {
  return useQuery({
    queryKey: ['cms', 'blog', shopId, params],
    queryFn: async (): Promise<ListResponse<BlogPostDto>> =>
      (
        await api.get('/cms/blog', {
          params: { ...shopParams(shopId), ...params },
        })
      ).data,
    enabled: !!shopId,
    placeholderData: keepPreviousData,
  });
}

export interface BlogInput {
  title: string;
  slug?: string;
  excerpt?: string | null;
  bodyHtml?: string | null;
  coverImage?: string | null;
  status: string;
  author?: string | null;
  tags: string[];
  seo: SeoFields;
}

export function useCreateBlogPost(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BlogInput): Promise<BlogPostDto> =>
      (
        await api.post(
          '/cms/blog',
          { ...input, shopId: shopId ?? undefined },
          { params: shopParams(shopId) },
        )
      ).data.post,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cms', 'blog', shopId] }),
  });
}

export function useUpdateBlogPost(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<BlogInput> }): Promise<BlogPostDto> =>
      (
        await api.patch(`/cms/blog/${vars.id}`, vars.patch, {
          params: shopParams(shopId),
        })
      ).data.post,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cms', 'blog', shopId] }),
  });
}

export function useDeleteBlogPost(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/cms/blog/${id}`, { params: shopParams(shopId) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cms', 'blog', shopId] }),
  });
}

// ════════════════════════════════════════════════════════════════
//  MENUS
// ════════════════════════════════════════════════════════════════
export function useMenus(shopId: string | null, location?: string) {
  return useQuery({
    queryKey: ['cms', 'menus', shopId, location ?? null],
    queryFn: async (): Promise<{ items: CmsMenuDto[] }> =>
      (
        await api.get('/cms/menus', {
          params: { ...shopParams(shopId), location: location || undefined },
        })
      ).data,
    enabled: !!shopId,
  });
}

export function useMenu(shopId: string | null, id: string | null) {
  return useQuery({
    queryKey: ['cms', 'menu', shopId, id],
    queryFn: async (): Promise<{ menu: CmsMenuDto }> =>
      (await api.get(`/cms/menus/${id}`, { params: shopParams(shopId) })).data,
    enabled: !!shopId && !!id,
  });
}

export interface MenuInput {
  location: string;
  name: string;
}

export function useCreateMenu(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MenuInput): Promise<CmsMenuDto> =>
      (
        await api.post(
          '/cms/menus',
          { ...input, shopId: shopId ?? undefined },
          { params: shopParams(shopId) },
        )
      ).data.menu,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cms', 'menus', shopId] }),
  });
}

export function useUpdateMenu(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<MenuInput> }): Promise<CmsMenuDto> =>
      (
        await api.patch(`/cms/menus/${vars.id}`, vars.patch, {
          params: shopParams(shopId),
        })
      ).data.menu,
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['cms', 'menus', shopId] });
      void qc.invalidateQueries({ queryKey: ['cms', 'menu', shopId, vars.id] });
    },
  });
}

export function useDeleteMenu(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/cms/menus/${id}`, { params: shopParams(shopId) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cms', 'menus', shopId] }),
  });
}

/** Payload-item voor de bulk-replace endpoint (nesting via ref/parentRef). */
export interface BulkItem {
  ref: string;
  parentRef: string | null;
  label: string;
  url: string;
  position: number;
}

/** PUT /cms/menus/:id/items — vervangt de hele item-set (reorder/restructure). */
export function useReplaceMenuItems(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { menuId: string; items: BulkItem[] }): Promise<CmsMenuItemDto[]> =>
      (
        await api.put(
          `/cms/menus/${vars.menuId}/items`,
          { items: vars.items },
          { params: shopParams(shopId) },
        )
      ).data.items,
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['cms', 'menu', shopId, vars.menuId] });
      void qc.invalidateQueries({ queryKey: ['cms', 'menus', shopId] });
    },
  });
}

// ════════════════════════════════════════════════════════════════
//  MEDIA
// ════════════════════════════════════════════════════════════════
export interface MediaListParams {
  folder?: string;
  scope?: 'shop' | 'global' | 'all';
  limit?: number;
  offset?: number;
}

export function useMedia(shopId: string | null, params: MediaListParams) {
  return useQuery({
    queryKey: ['cms', 'media', shopId, params],
    queryFn: async (): Promise<ListResponse<CmsMediaDto>> =>
      (
        await api.get('/cms/media', {
          params: { ...shopParams(shopId), ...params },
        })
      ).data,
    // media werkt ook globaal (zonder shop), maar in de admin tonen we shop-scoped.
    enabled: !!shopId,
    placeholderData: keepPreviousData,
  });
}

export function useUpdateMedia(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      patch: { alt?: string | null; folder?: string };
    }): Promise<CmsMediaDto> =>
      (await api.patch(`/cms/media/${vars.id}`, vars.patch)).data.media,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cms', 'media', shopId] }),
  });
}

export function useDeleteMedia(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/cms/media/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cms', 'media', shopId] }),
  });
}
