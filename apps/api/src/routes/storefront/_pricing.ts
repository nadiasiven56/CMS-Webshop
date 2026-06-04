/**
 * Pricing + voorraad-helpers voor de storefront.
 *
 * Effectieve prijs-regel:
 *   - shop_products.price_override gezet → dat is de prijs voor ELKE variant
 *     van dat product in die shop.
 *   - anders → de variant-eigen `price`.
 *
 * Voorraad: som van `inventory_levels.available` over alle locations voor het
 * inventory_item dat aan de variant hangt. Geen tracked-item → behandel als
 * onbeperkt voorradig (we geven dan een hoog getal terug; storefront mag
 * desgewenst `inStock` gebruiken).
 */
import { inArray, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import {
  inventoryItems,
  inventoryLevels,
  type Variant,
} from '../../db/schema/index.js';
import { money, type Money } from '@webshop-crm/shared/types/money';

/** Effectieve prijs voor een variant gegeven een optionele shop-override. */
export function effectivePrice(
  variant: Pick<Variant, 'price'>,
  priceOverride: string | null,
): string {
  return priceOverride != null ? priceOverride : variant.price;
}

/** Sentinel voor "untracked / oneindig voorradig". */
export const UNLIMITED_STOCK = 1_000_000;

/**
 * Beschikbare voorraad per variant-id (som over locations). Variants zonder
 * tracked inventory_item krijgen UNLIMITED_STOCK.
 *
 * Gebruikt `inArray()` — NOOIT ANY() (postgres-js crash).
 */
export async function availableByVariant(
  variantIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (variantIds.length === 0) return result;

  // 1. variant → inventory_item + tracked-flag
  const items = await db
    .select({
      variantId: inventoryItems.variantId,
      itemId: inventoryItems.id,
      tracked: inventoryItems.tracked,
    })
    .from(inventoryItems)
    .where(inArray(inventoryItems.variantId, variantIds));

  const itemIdByVariant = new Map<string, string>();
  const untrackedVariants = new Set<string>();
  const itemIds: string[] = [];
  for (const it of items) {
    if (!it.tracked) {
      untrackedVariants.add(it.variantId);
      continue;
    }
    itemIdByVariant.set(it.variantId, it.itemId);
    itemIds.push(it.itemId);
  }

  // 2. som(available) per item over alle locations
  const sums = new Map<string, number>();
  if (itemIds.length > 0) {
    const levels = await db
      .select({
        itemId: inventoryLevels.itemId,
        available: inventoryLevels.available,
      })
      .from(inventoryLevels)
      .where(inArray(inventoryLevels.itemId, itemIds));
    for (const lvl of levels) {
      sums.set(lvl.itemId, (sums.get(lvl.itemId) ?? 0) + lvl.available);
    }
  }

  for (const variantId of variantIds) {
    if (untrackedVariants.has(variantId)) {
      result.set(variantId, UNLIMITED_STOCK);
      continue;
    }
    const itemId = itemIdByVariant.get(variantId);
    if (!itemId) {
      // Geen inventory_item → niet getrackt → onbeperkt (V1-keuze).
      result.set(variantId, UNLIMITED_STOCK);
      continue;
    }
    result.set(variantId, sums.get(itemId) ?? 0);
  }
  return result;
}

/** Available voor één variant (convenience). */
export async function availableForVariant(variantId: string): Promise<number> {
  const map = await availableByVariant([variantId]);
  return map.get(variantId) ?? 0;
}

/** Som van line-totals als Money-string. */
export function sumMoney(values: string[]): Money {
  let acc = money(0);
  for (const v of values) {
    acc = money(Number(acc) + Number(v));
  }
  return acc;
}

/** Vermenigvuldig prijs × qty, terug als Money-string. */
export function lineTotal(unitPrice: string, quantity: number): string {
  return money(Number(unitPrice) * quantity);
}

void eq; // re-exported elders; voorkom unused-warning indien tree-shaken
