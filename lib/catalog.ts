// Service, property and option definitions for the public Residentas Guest
// Services booking experience.
//
// These mirror the existing Guest Services /book form exactly. Field names,
// allowed values and required/optional behaviour are preserved so the payload
// stays compatible with the authoritative Guest Services backend.
//
// NOTE: pricing is deliberately NOT defined here. Guest Services computes the
// authoritative price server-side and never trusts a client-supplied amount.

export const SERVICE_TYPES = ["transfer", "tuktuk"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_LABELS: Record<ServiceType, string> = {
  transfer: "Airport Transfer",
  tuktuk: "Tuk-Tuk Tour",
};

/** Apartment options, matching the Guest Services /book select. */
export const PROPERTIES = [
  "Residentas Áurea",
  "Residentas Arco do Bandeira",
  "Residentas São Pedro",
  "Residentas Apóstolos",
] as const;

export const DIRECTIONS = ["airport-apt", "apt-airport", "both"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_LABELS: Record<Direction, string> = {
  "airport-apt": "Airport to Apartment",
  "apt-airport": "Apartment to Airport",
  both: "Both ways",
};

/** Supporting copy shown under each direction choice, matching /book. */
export const DIRECTION_HINTS: Record<Direction, string> = {
  "airport-apt": "Flight lands → we pick you up",
  "apt-airport": "We take you to catch your flight",
  both: "Arrival + departure covered",
};

/**
 * Field labels vary by direction: a one-way transfer says "Flight number",
 * whereas the both-ways form must distinguish arrival from departure. These
 * mirror /book exactly.
 */
export const TRANSFER_FIELD_LABELS = {
  arrFlight: { oneWay: "Flight number", both: "Arrival flight" },
  arrOrigin: { oneWay: "Origin airport / city", both: "Origin city" },
  depFlight: { oneWay: "Flight number", both: "Departure flight" },
  depDest: { oneWay: "Destination airport / city", both: "Destination city" },
} as const;

/** Passenger counts offered for transfers (drives authoritative pricing upstream). */
export const PAX_OPTIONS = [2, 3, 4, 5] as const;

export const ROUTES = ["castle", "chiado", "belem"] as const;
export type TukTukRoute = (typeof ROUTES)[number];

export const ROUTE_LABELS: Record<TukTukRoute, string> = {
  castle: "São Jorge Castle",
  chiado: "Chiado / Bairro Alto",
  belem: "Belém area",
};

/** Tour durations in minutes, matching /book. */
export const DURATIONS = [60, 90, 120, 180, 240, 480] as const;
export type DurationMins = (typeof DURATIONS)[number];

export const DURATION_LABELS: Record<number, string> = {
  60: "1 hour",
  90: "1.5 hours",
  120: "2 hours",
  180: "3 hours",
  240: "4 hours",
  480: "Full day (8h)",
};

export const BAG_OPTIONS = ["0", "1", "2", "3", "4", "5+"] as const;
export const CABIN_BAG_OPTIONS = ["0", "1", "2", "3", "4+"] as const;
export const CHILD_SEAT_OPTIONS = ["0", "1", "2"] as const;
