import { test, expect } from "vitest";

import {
  EMPTY_BOOKING,
  isValid,
  normalizeBooking,
  toGuestServicesPayload,
  validateBooking,
  type BookingInput,
} from "@/lib/bookingSchema";
import { PROPERTIES } from "@/lib/catalog";

function transfer(overrides: Partial<BookingInput> = {}): BookingInput {
  return {
    ...EMPTY_BOOKING,
    service: "transfer",
    firstName: "Ana",
    lastName: "Lopes",
    email: "ana@example.com",
    hotel: PROPERTIES[0],
    pax: 2,
    direction: "airport-apt",
    ...overrides,
  };
}

function tuktuk(overrides: Partial<BookingInput> = {}): BookingInput {
  return {
    ...EMPTY_BOOKING,
    service: "tuktuk",
    firstName: "Casey",
    lastName: "Silva",
    email: "casey@example.com",
    hotel: PROPERTIES[1],
    tuktukDate: "2026-09-01",
    durationMins: 120,
    ...overrides,
  };
}

// --- shared required fields ---

test("a complete transfer booking is valid", () => {
  expect(isValid(validateBooking(transfer()))).toBe(true);
});

test("a complete tuk-tuk booking is valid", () => {
  expect(isValid(validateBooking(tuktuk()))).toBe(true);
});

test("first name, last name and apartment are required", () => {
  const errors = validateBooking(transfer({ firstName: "", lastName: "", hotel: "" }));

  expect(errors.firstName).toBeTruthy();
  expect(errors.lastName).toBeTruthy();
  expect(errors.hotel).toBeTruthy();
});

test("at least one of email or phone is required", () => {
  const errors = validateBooking(transfer({ email: "", phone: "" }));
  expect(errors.email).toMatch(/email or phone/i);

  // phone alone is acceptable, mirroring Guest Services
  expect(isValid(validateBooking(transfer({ email: "", phone: "+351912345678" })))).toBe(true);
});

test("an invalid email is rejected", () => {
  expect(validateBooking(transfer({ email: "not-an-email" })).email).toMatch(/valid email/i);
  expect(validateBooking(transfer({ email: "missing@domain" })).email).toMatch(/valid email/i);
});

test("an apartment outside the known list is rejected", () => {
  expect(validateBooking(transfer({ hotel: "Some Other Hotel" })).hotel).toBeTruthy();
});

test("an unsupported service type is rejected", () => {
  expect(validateBooking({ ...EMPTY_BOOKING, service: "helicopter" }).service).toBeTruthy();
});

// --- service-specific rules ---

test("transfer requires a passenger count", () => {
  expect(validateBooking(transfer({ pax: null })).pax).toMatch(/passengers/i);
});

test("transfer rejects an unsupported passenger count", () => {
  expect(validateBooking(transfer({ pax: 9 })).pax).toBeTruthy();
});

test("transfer rejects an unknown direction", () => {
  expect(validateBooking(transfer({ direction: "sideways" })).direction).toBeTruthy();
});

test("transfer rejects a malformed arrival date", () => {
  expect(validateBooking(transfer({ arrDate: "01/09/2026" })).arrDate).toBeTruthy();
  expect(isValid(validateBooking(transfer({ arrDate: "2026-09-01" })))).toBe(true);
});

test("tuk-tuk requires a tour date and a duration", () => {
  expect(validateBooking(tuktuk({ tuktukDate: "" })).tuktukDate).toMatch(/date/i);
  expect(validateBooking(tuktuk({ durationMins: null })).durationMins).toMatch(/duration/i);
});

test("tuk-tuk rejects an unsupported duration and an unknown route", () => {
  expect(validateBooking(tuktuk({ durationMins: 37 })).durationMins).toBeTruthy();
  expect(validateBooking(tuktuk({ route: "moon" })).route).toBeTruthy();
  expect(isValid(validateBooking(tuktuk({ route: "belem" })))).toBe(true);
});

test("transfer rules do not leak into tuk-tuk bookings", () => {
  // A tuk-tuk without pax/direction must still be valid.
  const errors = validateBooking(tuktuk({ pax: null }));
  expect(errors.pax).toBeUndefined();
  expect(isValid(errors)).toBe(true);
});

// --- normalisation ---

test("normalizeBooking coerces unknown input safely", () => {
  const normalized = normalizeBooking({ service: "tuktuk", firstName: "  Ana  ", pax: "3", durationMins: "120" });

  expect(normalized.service).toBe("tuktuk");
  expect(normalized.firstName).toBe("Ana");
  expect(normalized.pax).toBe(3);
  expect(normalized.durationMins).toBe(120);
});

test("normalizeBooking survives null, arrays and junk", () => {
  for (const junk of [null, undefined, [], "string", 42]) {
    const normalized = normalizeBooking(junk);
    expect(normalized.service).toBe("transfer");
    expect(normalized.firstName).toBe("");
  }
});

// --- upstream payload shape ---

test("payload preserves the Guest Services field names verbatim", () => {
  const payload = toGuestServicesPayload(transfer({ room: "12A" }));

  for (const key of [
    "service", "firstName", "lastName", "email", "phone", "hotel", "room",
    "pax", "direction", "bagsCheckin", "bagsCabin", "childSeats", "transferNotes",
    "arrDate", "arrFlight", "arrTime", "arrOrigin",
    "depDate", "depFlight", "depPickup", "depDest",
    "bthArrDate", "bthArrFlight", "bthArrTime", "bthArrOrigin",
    "bthDepDate", "bthDepFlight", "bthDepPickup", "bthDepDest",
    "tuktukDate", "tuktukTime", "tuktukPax", "route", "durationMins", "tuktukNotes",
  ]) {
    expect(payload).toHaveProperty(key);
  }
});

test("payload never carries a client-supplied price", () => {
  const payload = toGuestServicesPayload(transfer()) as Record<string, unknown>;

  expect(payload).not.toHaveProperty("price");
  expect(payload).not.toHaveProperty("amount");
  expect(payload).not.toHaveProperty("total");
  expect(JSON.stringify(payload)).not.toMatch(/price/i);
});
