/**
 * Serializers — Drizzle-row → API-DTO.
 *
 * Wat hier gebeurt:
 *   - Date → ISO-string
 *   - numeric (string in pg-driver) blijft string
 *   - jsonb shape stabiel houden
 */
import type {
  Product,
  Variant,
  ProductOption,
  ProductOptionValue,
  ProductImage,
} from '../../db/schema/index.js';

export interface ProductCoreDto {
  id: string;
  slug: string;
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  status: string;
  tags: string[];
  /** Eigenaar (multi-user). `null` = platform-catalogus van de operator. */
  ownerUserId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toProductCore(p: Product): ProductCoreDto {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    vendor: p.vendor,
    productType: p.productType,
    status: p.status,
    tags: p.tags,
    ownerUserId: p.ownerUserId ?? null,
    publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export interface VariantDto {
  id: string;
  productId: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  costPrice: string | null;
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  barcode: string | null;
  selectedOptions: Record<string, string>;
  position: number;
  taxable: boolean;
  taxClass: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toVariantDto(v: Variant): VariantDto {
  return {
    id: v.id,
    productId: v.productId,
    sku: v.sku,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    costPrice: v.costPrice,
    weightG: v.weightG,
    lengthMm: v.lengthMm,
    widthMm: v.widthMm,
    heightMm: v.heightMm,
    barcode: v.barcode,
    selectedOptions: v.selectedOptions,
    position: v.position,
    taxable: v.taxable,
    taxClass: v.taxClass,
    active: v.active,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

export interface ProductOptionDto {
  id: string;
  productId: string;
  name: string;
  position: number;
  values: Array<{ id: string; value: string; position: number }>;
}

export function toProductOptionDto(
  o: ProductOption,
  values: ProductOptionValue[],
): ProductOptionDto {
  return {
    id: o.id,
    productId: o.productId,
    name: o.name,
    position: o.position,
    values: values
      .filter((v) => v.optionId === o.id)
      .map((v) => ({ id: v.id, value: v.value, position: v.position })),
  };
}

export interface ProductImageDto {
  id: string;
  productId: string;
  url: string;
  alt: string | null;
  position: number;
  createdAt: string;
}

export function toProductImageDto(img: ProductImage): ProductImageDto {
  return {
    id: img.id,
    productId: img.productId,
    url: img.url,
    alt: img.alt,
    position: img.position,
    createdAt: img.createdAt.toISOString(),
  };
}
