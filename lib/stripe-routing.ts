// Phase 3D.1 — Multi-Stripe account routing.
//
// SINGLE source of truth for which Stripe account a payment is routed to.
// Business rule (confirmed by the business, verified in the Stripe account
// switcher): Residentas Arco do Bandeira → Residentas RMI account; every other
// property → Activos Reais account. These are two SEPARATE Stripe accounts,
// NOT Stripe Connect.
//
// Do not duplicate these conditions anywhere else — import from here.

export type StripeAccountKey = 'rmi' | 'activos_reais';

// The booking form only submits the apartment display name (`hotel`), so we map
// the known display names to canonical, stable property codes here.
type PropertyDef = { code: string; label: string };

const PROPERTIES: PropertyDef[] = [
  { code: 'arco', label: 'Residentas Arco do Bandeira' },
  { code: 'aurea', label: 'Residentas Áurea' },
  { code: 'sao-pedro', label: 'Residentas São Pedro' },
  { code: 'apostolos', label: 'Residentas Apóstolos' },
];

// Diacritic-insensitive, case-insensitive normalisation so "Áurea" and "Aurea"
// (or stray whitespace) resolve to the same property.
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Resolve the free-text apartment/hotel name to a canonical property_code.
 * Unknown names fall back to a slug of the input so a newly-added apartment
 * still yields a stable, non-'arco' code (and therefore routes to Activos Reais)
 * without requiring a code change. Empty input yields 'unknown'.
 */
export function propertyCodeFromHotel(hotel: string | null | undefined): string {
  const folded = fold(hotel || '');
  if (!folded) return 'unknown';
  const match = PROPERTIES.find((p) => fold(p.label) === folded);
  if (match) return match.code;
  return folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

/**
 * Map a property_code to its Stripe account. This is the ONLY place the routing
 * condition lives. Anything that is not Arco routes to Activos Reais (safe
 * default — a mislabelled/unknown property never lands in the RMI account).
 */
export function routeAccount(propertyCode: string): StripeAccountKey {
  return propertyCode === 'arco' ? 'rmi' : 'activos_reais';
}
