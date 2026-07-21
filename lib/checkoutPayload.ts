import { EMPTY_BOOKING, type BookingInput } from "@/lib/bookingSchema";

// What may be sent upstream to Guest Services checkout.
//
// The upstream request is rebuilt from this explicit allowlist rather than
// forwarded, so nothing a caller invents — return URLs, account keys, Stripe
// ids, quote totals, currency or price overrides, arbitrary metadata — can ride
// along. Guest Services re-validates everything and recomputes the price.

/** The booking fields Guest Services consumes. Nothing else is forwarded. */
export const CHECKOUT_FIELDS = Object.keys(EMPTY_BOOKING) as (keyof BookingInput)[];

/** Fixed, server-controlled destination identifier. Never taken from a caller. */
export const CHECKOUT_SOURCE = "residentas-services";

export type CheckoutResult = { url: string; ref: string };

/**
 * Build the upstream payload from an unknown body, keeping only allowlisted
 * booking fields and stamping our own checkoutSource.
 */
export function buildCheckoutPayload(body: unknown): Record<string, unknown> {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const payload: Record<string, unknown> = {};

  for (const field of CHECKOUT_FIELDS) {
    if (raw[field] !== undefined) payload[field] = raw[field];
  }

  // Stamped last so a caller-supplied value can never win.
  payload.checkoutSource = CHECKOUT_SOURCE;
  return payload;
}

/**
 * Accept an upstream checkout response only if it carries a usable Stripe URL
 * and a reference. A malformed body must never become a redirect.
 */
export function parseCheckoutResult(payload: unknown): CheckoutResult | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;

  if (typeof raw.url !== "string" || typeof raw.ref !== "string" || !raw.ref) return null;

  let url: URL;
  try {
    url = new URL(raw.url);
  } catch {
    return null;
  }

  // Only ever redirect to a real https Stripe Checkout URL.
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "checkout.stripe.com" && !url.hostname.endsWith(".stripe.com")) return null;

  return { url: raw.url, ref: raw.ref };
}
