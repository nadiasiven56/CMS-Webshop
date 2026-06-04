/**
 * Re-export van de zod-schemas uit `@webshop-crm/shared` zodat alle
 * route-files een 1-regelige import hebben en TS-strict niet over
 * triple-namespace klaagt.
 */
export {
  TaxClassSchema,
  ProductStatusSchema,
  VariantCreateInputSchema,
  VariantUpdateInputSchema,
  ProductCreateInputSchema,
  ProductUpdateInputSchema,
  ListProductsQuerySchema,
  ProductOptionInputSchema,
  type TaxClass,
  type ProductStatus,
  type VariantCreateInput,
  type VariantUpdateInput,
  type ProductCreateInput,
  type ProductUpdateInput,
  type ProductOptionInput,
} from '@webshop-crm/shared/api/products';
