// Authoritative pricing for Residentas guest services.
//
// Ported verbatim from Guest Services `lib/pricing.ts` (Slice A) so quote
// generation no longer depends on GUEST_SERVICES_BASE_URL. The price tables and
// every exported function are byte-for-byte equivalent to the source, and
// `tests/pricing-parity.test.ts` re-checks that against the Guest Services file
// whenever it is reachable.
//
// IMPORTANT: Guest Services remains the authority for what is actually CHARGED.
// Checkout still recomputes the amount from its own copy of this module, so a
// divergence here would show a wrong estimate but could never mischarge a
// guest. Any price change must be applied to BOTH copies.

export type ServiceType = 'transfer' | 'tuktuk';
export type Direction = 'airport-apt' | 'apt-airport' | 'both';

// Transfer prices by passenger count and direction index.
const TRANSFER_PRICES: Record<number, [number, number, number]> = {
  2: [35, 25, 55],
  3: [45, 35, 75],
  4: [45, 35, 75],
  5: [55, 55, 100],
};
const DIR_IDX: Record<Direction, number> = { 'airport-apt': 0, 'apt-airport': 1, both: 2 };

// Tuk-tuk price by duration (minutes).
const TUKTUK_PRICES: Record<number, number> = {
  60: 100,
  90: 140,
  120: 190,
  180: 280,
  240: 320,
  480: 480,
};

export const CURRENCY = 'eur';

export type PricingInput = {
  service: ServiceType;
  pax?: number | string;
  direction?: string;
  durationMins?: number | string;
};

/** Direction applied when the caller omits or blanks it. */
export const DEFAULT_DIRECTION: Direction = 'airport-apt';

/**
 * Normalise the pricing-relevant inputs.
 *
 * Deliberately narrow: this touches only the three fields that affect price.
 * Guest identity, luggage, routes and notes are none of pricing's business.
 */
export function normalizePricingInput(input: PricingInput): PricingInput {
  const service: ServiceType = input.service === 'tuktuk' ? 'tuktuk' : 'transfer';

  if (service === 'tuktuk') {
    return { service, durationMins: input.durationMins };
  }

  const direction = typeof input.direction === 'string' ? input.direction.trim() : '';
  return {
    service,
    pax: input.pax,
    direction: direction || DEFAULT_DIRECTION,
  };
}

/**
 * Convert whole euros to the minor units Stripe charges. Shared so a quote can
 * never state an amount different from the one the customer is billed.
 */
export function toMinorUnits(euros: number): number {
  return Math.round(euros * 100);
}

/**
 * Returns the authoritative price in whole euros, or null if the inputs are
 * invalid (unknown pax/direction/duration). Never trusts a client-sent price.
 */
export function computePriceEuros(input: PricingInput): number | null {
  if (input.service === 'transfer') {
    const pax = Number(input.pax);
    const dir = input.direction as Direction;
    if (!TRANSFER_PRICES[pax]) return null;
    if (!(dir in DIR_IDX)) return null;
    return TRANSFER_PRICES[pax][DIR_IDX[dir]];
  }
  if (input.service === 'tuktuk') {
    const mins = Number(input.durationMins);
    const price = TUKTUK_PRICES[mins];
    return price ?? null;
  }
  return null;
}

/** Human label for the priced line item. */
export function serviceLabel(input: PricingInput): string {
  return input.service === 'transfer' ? 'Airport Transfer' : 'Tuk-Tuk Tour';
}
