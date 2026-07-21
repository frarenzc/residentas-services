import {
  DIRECTIONS,
  DURATIONS,
  PAX_OPTIONS,
  PROPERTIES,
  ROUTES,
  SERVICE_TYPES,
  type Direction,
  type ServiceType,
} from "@/lib/catalog";

// Shared request schema for the public booking form.
//
// The SAME rules run in the browser (inline messages) and again on the server
// (`/api/booking`), so the two can never drift. These rules deliberately mirror
// the authoritative Guest Services checkout validation
// (`app/api/checkout/create-session/route.ts`) — they are a compatible
// pre-check, not a replacement. Guest Services re-validates everything and
// remains the source of truth; it also computes the price, which is never
// accepted from the browser.

export type BookingInput = {
  service: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  hotel: string;
  room: string;
  // transfer
  pax: number | null;
  direction: string;
  bagsCheckin: string;
  bagsCabin: string;
  childSeats: string;
  transferNotes: string;
  arrDate: string;
  arrFlight: string;
  arrTime: string;
  arrOrigin: string;
  depDate: string;
  depFlight: string;
  depPickup: string;
  depDest: string;
  bthArrDate: string;
  bthArrFlight: string;
  bthArrTime: string;
  bthArrOrigin: string;
  bthDepDate: string;
  bthDepFlight: string;
  bthDepPickup: string;
  bthDepDest: string;
  // tuk-tuk
  tuktukDate: string;
  tuktukTime: string;
  tuktukPax: string;
  route: string | null;
  durationMins: number | null;
  tuktukNotes: string;
};

export const EMPTY_BOOKING: BookingInput = {
  service: "transfer",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  hotel: "",
  room: "",
  pax: null,
  direction: "airport-apt",
  bagsCheckin: "2",
  bagsCabin: "2",
  childSeats: "0",
  transferNotes: "",
  arrDate: "",
  arrFlight: "",
  arrTime: "",
  arrOrigin: "",
  depDate: "",
  depFlight: "",
  depPickup: "",
  depDest: "",
  bthArrDate: "",
  bthArrFlight: "",
  bthArrTime: "",
  bthArrOrigin: "",
  bthDepDate: "",
  bthDepFlight: "",
  bthDepPickup: "",
  bthDepDest: "",
  tuktukDate: "",
  tuktukTime: "",
  tuktukPax: "",
  route: null,
  durationMins: null,
  tuktukNotes: "",
};

/** Field-keyed validation errors; empty object means valid. */
export type FieldErrors = Partial<Record<keyof BookingInput | "form", string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isServiceType(value: string): value is ServiceType {
  return (SERVICE_TYPES as readonly string[]).includes(value);
}

function isDirection(value: string): value is Direction {
  return (DIRECTIONS as readonly string[]).includes(value);
}

/** Normalise an unknown request body into a BookingInput (never throws). */
export function normalizeBooking(body: unknown): BookingInput {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const pax = Number(raw.pax);
  const duration = Number(raw.durationMins);

  return {
    ...EMPTY_BOOKING,
    service: str(raw.service) || "transfer",
    firstName: str(raw.firstName),
    lastName: str(raw.lastName),
    email: str(raw.email),
    phone: str(raw.phone),
    hotel: str(raw.hotel),
    room: str(raw.room),
    pax: Number.isFinite(pax) && pax > 0 ? pax : null,
    direction: str(raw.direction) || "airport-apt",
    bagsCheckin: str(raw.bagsCheckin) || EMPTY_BOOKING.bagsCheckin,
    bagsCabin: str(raw.bagsCabin) || EMPTY_BOOKING.bagsCabin,
    childSeats: str(raw.childSeats) || EMPTY_BOOKING.childSeats,
    transferNotes: str(raw.transferNotes),
    arrDate: str(raw.arrDate),
    arrFlight: str(raw.arrFlight),
    arrTime: str(raw.arrTime),
    arrOrigin: str(raw.arrOrigin),
    depDate: str(raw.depDate),
    depFlight: str(raw.depFlight),
    depPickup: str(raw.depPickup),
    depDest: str(raw.depDest),
    bthArrDate: str(raw.bthArrDate),
    bthArrFlight: str(raw.bthArrFlight),
    bthArrTime: str(raw.bthArrTime),
    bthArrOrigin: str(raw.bthArrOrigin),
    bthDepDate: str(raw.bthDepDate),
    bthDepFlight: str(raw.bthDepFlight),
    bthDepPickup: str(raw.bthDepPickup),
    bthDepDest: str(raw.bthDepDest),
    tuktukDate: str(raw.tuktukDate),
    tuktukTime: str(raw.tuktukTime),
    tuktukPax: str(raw.tuktukPax),
    route: str(raw.route) || null,
    durationMins: Number.isFinite(duration) && duration > 0 ? duration : null,
    tuktukNotes: str(raw.tuktukNotes),
  };
}

/**
 * Validate a booking. Mirrors the Guest Services checkout rules:
 *  - first name, last name and apartment are required
 *  - at least one of email / phone
 *  - transfer: passenger count required
 *  - tuk-tuk: tour date and duration required
 * Plus format checks (email shape, ISO dates, known enum values) which fail
 * fast client-side instead of bouncing off the upstream API.
 */
export function validateBooking(input: BookingInput): FieldErrors {
  const errors: FieldErrors = {};

  if (!isServiceType(input.service)) {
    errors.service = "Choose a service.";
    return errors; // service drives the rest of the rules
  }

  if (!input.firstName) errors.firstName = "First name is required.";
  if (!input.lastName) errors.lastName = "Last name is required.";
  if (!input.hotel) {
    errors.hotel = "Select your apartment.";
  } else if (!(PROPERTIES as readonly string[]).includes(input.hotel)) {
    errors.hotel = "Select an apartment from the list.";
  }

  if (!input.email && !input.phone) {
    errors.email = "Provide at least an email or phone number.";
  } else if (input.email && !EMAIL_PATTERN.test(input.email)) {
    errors.email = "Enter a valid email address.";
  }

  if (input.service === "transfer") {
    if (!input.pax) {
      errors.pax = "Select the number of passengers.";
    } else if (!(PAX_OPTIONS as readonly number[]).includes(input.pax)) {
      errors.pax = "Select a valid number of passengers.";
    }

    if (!isDirection(input.direction)) {
      errors.direction = "Select a valid direction.";
    }

    if (input.direction === "airport-apt" && input.arrDate && !DATE_PATTERN.test(input.arrDate)) {
      errors.arrDate = "Enter a valid arrival date.";
    }
    if (input.direction === "apt-airport" && input.depDate && !DATE_PATTERN.test(input.depDate)) {
      errors.depDate = "Enter a valid departure date.";
    }
    if (input.direction === "both") {
      if (input.bthArrDate && !DATE_PATTERN.test(input.bthArrDate)) {
        errors.bthArrDate = "Enter a valid arrival date.";
      }
      if (input.bthDepDate && !DATE_PATTERN.test(input.bthDepDate)) {
        errors.bthDepDate = "Enter a valid departure date.";
      }
    }
  } else {
    if (!input.tuktukDate) {
      errors.tuktukDate = "Select a date for the tour.";
    } else if (!DATE_PATTERN.test(input.tuktukDate)) {
      errors.tuktukDate = "Enter a valid tour date.";
    }

    if (!input.durationMins) {
      errors.durationMins = "Select a tour duration.";
    } else if (!(DURATIONS as readonly number[]).includes(input.durationMins)) {
      errors.durationMins = "Select a valid tour duration.";
    }

    if (input.route && !(ROUTES as readonly string[]).includes(input.route)) {
      errors.route = "Select a route from the list.";
    }
  }

  return errors;
}

export function isValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * The exact payload shape the Guest Services checkout endpoint expects.
 * Field names are preserved verbatim so the upstream contract is unchanged.
 * The price is intentionally absent — Guest Services computes it.
 */
export function toGuestServicesPayload(input: BookingInput) {
  return {
    service: input.service,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    hotel: input.hotel,
    room: input.room,
    pax: input.pax,
    direction: input.direction,
    bagsCheckin: input.bagsCheckin,
    bagsCabin: input.bagsCabin,
    childSeats: input.childSeats,
    transferNotes: input.transferNotes,
    arrDate: input.arrDate,
    arrFlight: input.arrFlight,
    arrTime: input.arrTime,
    arrOrigin: input.arrOrigin,
    depDate: input.depDate,
    depFlight: input.depFlight,
    depPickup: input.depPickup,
    depDest: input.depDest,
    bthArrDate: input.bthArrDate,
    bthArrFlight: input.bthArrFlight,
    bthArrTime: input.bthArrTime,
    bthArrOrigin: input.bthArrOrigin,
    bthDepDate: input.bthDepDate,
    bthDepFlight: input.bthDepFlight,
    bthDepPickup: input.bthDepPickup,
    bthDepDest: input.bthDepDest,
    tuktukDate: input.tuktukDate,
    tuktukTime: input.tuktukTime,
    tuktukPax: input.tuktukPax,
    route: input.route,
    durationMins: input.durationMins,
    tuktukNotes: input.tuktukNotes,
  };
}
