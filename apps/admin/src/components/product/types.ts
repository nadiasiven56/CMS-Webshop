/**
 * Lokale type-aliases voor de admin product-UI.
 * Dunne wrapper rond `@webshop-crm/shared/api/products` namespace zodat
 * components met losse named-types werken.
 */
import type {
  ProductWithRelations,
  ProductCore,
  ProductListItem,
  ProductCreateInput,
  ProductUpdateInput,
  VariantDto as SharedVariantDto,
  VariantCreateInput,
  VariantUpdateInput,
  ProductOptionDto as SharedProductOptionDto,
  ProductImageDto as SharedProductImageDto,
  ProductStatus,
} from '@webshop-crm/shared/api/products';

export type {
  ProductWithRelations,
  ProductCore,
  ProductListItem,
  ProductCreateInput,
  ProductUpdateInput,
  ProductStatus,
};

export type VariantDto = SharedVariantDto;
export type ProductOptionDto = SharedProductOptionDto;
export type ProductImageDto = SharedProductImageDto;
export type { VariantCreateInput, VariantUpdateInput };
