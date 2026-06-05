/**
 * Pure unit-tests voor de order-status-state-machine (geen DB).
 *
 *  - `derivedStatuses` zet per doel-status de juiste financial/fulfillment-velden.
 *  - `isValidTransition` staat geldige overgangen toe en weigert vanuit de
 *    terminale statussen (cancelled/refunded → alles false) + self-transitions.
 */
import { describe, it, expect } from 'vitest';
import {
  derivedStatuses,
  isValidTransition,
  allowedNextStatuses,
  ORDER_STATUSES,
  type OrderStatus,
} from '../status-machine.js';

describe('derivedStatuses', () => {
  it('paid → financialStatus paid', () => {
    expect(derivedStatuses('paid')).toEqual({ financialStatus: 'paid' });
  });

  it('fulfilled → fulfillmentStatus fulfilled', () => {
    expect(derivedStatuses('fulfilled')).toEqual({ fulfillmentStatus: 'fulfilled' });
  });

  it('shipped → fulfillmentStatus shipped', () => {
    expect(derivedStatuses('shipped')).toEqual({ fulfillmentStatus: 'shipped' });
  });

  it('delivered → fulfillmentStatus delivered', () => {
    expect(derivedStatuses('delivered')).toEqual({ fulfillmentStatus: 'delivered' });
  });

  it('refunded → financialStatus refunded', () => {
    expect(derivedStatuses('refunded')).toEqual({ financialStatus: 'refunded' });
  });

  it('cancelled → geen afgeleide velden', () => {
    expect(derivedStatuses('cancelled')).toEqual({});
  });
});

describe('isValidTransition', () => {
  it('staat de voorwaartse hoofdketen toe', () => {
    expect(isValidTransition('pending', 'paid')).toBe(true);
    expect(isValidTransition('paid', 'fulfilled')).toBe(true);
    expect(isValidTransition('fulfilled', 'shipped')).toBe(true);
    expect(isValidTransition('shipped', 'delivered')).toBe(true);
  });

  it('staat cancellen/refunden toe waar gemodelleerd', () => {
    expect(isValidTransition('pending', 'cancelled')).toBe(true);
    expect(isValidTransition('paid', 'refunded')).toBe(true);
    expect(isValidTransition('delivered', 'refunded')).toBe(true);
  });

  it('weigert een self-transition', () => {
    for (const s of ORDER_STATUSES) {
      expect(isValidTransition(s, s)).toBe(false);
    }
  });

  it('weigert ALLES vanuit de terminale statussen cancelled/refunded', () => {
    for (const to of ORDER_STATUSES) {
      expect(isValidTransition('cancelled', to as OrderStatus)).toBe(false);
      expect(isValidTransition('refunded', to as OrderStatus)).toBe(false);
    }
    expect(allowedNextStatuses('cancelled')).toEqual([]);
    expect(allowedNextStatuses('refunded')).toEqual([]);
  });

  it('weigert een sprong die niet gemodelleerd is (pending → delivered)', () => {
    expect(isValidTransition('pending', 'delivered')).toBe(false);
    expect(isValidTransition('pending', 'shipped')).toBe(false);
  });
});
