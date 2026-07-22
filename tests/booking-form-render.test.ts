import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import BookingForm from "@/components/BookingForm";
import {
  DIRECTIONS,
  DIRECTION_HINTS,
  DIRECTION_LABELS,
  DURATION_LABELS,
  PROPERTIES,
  ROUTE_LABELS,
  TRANSFER_FIELD_LABELS,
} from "@/lib/catalog";

function render(): string {
  return renderToStaticMarkup(createElement(BookingForm));
}

test("the form renders both service options", () => {
  const html = render();

  expect(html).toContain("Airport Transfer");
  expect(html).toContain("Tuk-Tuk Tour");
});

test("every apartment is selectable", () => {
  const html = render();

  for (const property of PROPERTIES) {
    expect(html).toContain(property);
  }
});

test("the shared guest fields are present", () => {
  const html = render();

  for (const field of ["firstName", "lastName", "email", "phone", "hotel", "room"]) {
    expect(html).toContain(`name="${field}"`);
  }
});

test("transfer is the default service, so transfer fields render and tuk-tuk fields do not", () => {
  const html = render();

  expect(html).toContain('name="pax"');
  expect(html).toContain('data-testid="direction-cards"');
  expect(html).not.toContain('name="tuktukDate"');
  expect(html).not.toContain('name="durationMins"');
});

test("direction is chosen with cards, one per direction, matching /book", () => {
  const html = render();

  for (const direction of DIRECTIONS) {
    expect(html).toContain(DIRECTION_LABELS[direction]);
    expect(html).toContain(DIRECTION_HINTS[direction]);
  }
});

test("the direction cards are a keyboard-accessible radio group", () => {
  const html = render();

  // /book renders these as <div onClick>, which cannot be tabbed to. Here they
  // must be real buttons in a radiogroup with checked state exposed.
  expect(html).toContain('role="radiogroup"');
  expect(html).toMatch(/<button[^>]*role="radio"[^>]*aria-checked="true"/);
  expect((html.match(/class="dir-card/g) ?? []).length).toBe(DIRECTIONS.length);
  expect(html).not.toMatch(/<div[^>]*class="dir-card/);
});

test("transfer details are grouped into arrival and luggage sections, as /book does", () => {
  const html = render();

  expect(html).toContain("Arrival &amp; departure");
  expect(html).toContain("Luggage &amp; comforts");
  expect(html).toContain('data-testid="luggage-fields"');
});

test("the default direction shows arrival fields only", () => {
  const html = render();

  expect(html).toContain('name="arrDate"');
  expect(html).toContain('name="arrFlight"');
  // departure-only and both-ways field sets stay hidden
  expect(html).not.toContain('name="depDate"');
  expect(html).not.toContain('name="bthArrDate"');
});

test("one-way transfers use the one-way labels", () => {
  const html = render();

  // Default direction is airport-apt, so the generic wording applies.
  expect(html).toContain(TRANSFER_FIELD_LABELS.arrFlight.oneWay);
  expect(html).toContain(TRANSFER_FIELD_LABELS.arrOrigin.oneWay);
  expect(html).not.toContain(TRANSFER_FIELD_LABELS.arrFlight.both);
});

test("field labels match /book exactly for both one-way and both-ways", () => {
  // /book distinguishes arrival from departure only in the both-ways form.
  expect(TRANSFER_FIELD_LABELS.arrFlight).toEqual({ oneWay: "Flight number", both: "Arrival flight" });
  expect(TRANSFER_FIELD_LABELS.arrOrigin).toEqual({ oneWay: "Origin airport / city", both: "Origin city" });
  expect(TRANSFER_FIELD_LABELS.depFlight).toEqual({ oneWay: "Flight number", both: "Departure flight" });
  expect(TRANSFER_FIELD_LABELS.depDest).toEqual({ oneWay: "Destination airport / city", both: "Destination city" });
});

test("the form exposes a submit control", () => {
  expect(render()).toMatch(/<button[^>]*type="submit"/);
});

// --- safety: nothing sensitive reaches the browser bundle ---

test("passenger price cards render from the approved reference design", () => {
  const html = render();

  expect(html).toContain("Passenger count");
  expect(html).toContain("2 PAX");
  expect(html).toContain("Airport → Apt");
  expect(html).toContain("35€");
  expect(html).toContain("Good to know");
});

test("the pricing tables themselves are absent from this app", async () => {
  const { readFile } = await import("node:fs/promises");
  const catalog = await readFile(new URL("../lib/catalog.ts", import.meta.url), "utf8");

  // Duration and route choices live here; their prices must not.
  expect(catalog).toContain(DURATION_LABELS[120]);
  expect(catalog).toContain(ROUTE_LABELS.belem);
  expect(catalog).not.toMatch(/TRANSFER_PRICES|TUKTUK_PRICES|computePrice/);
});

test("the client component references no secret-bearing environment variables", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../components/BookingForm.tsx", import.meta.url), "utf8");

  for (const forbidden of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GUEST_SERVICES_API_TOKEN",
    "GUEST_SERVICES_BASE_URL",
    "Authorization",
    "Bearer",
  ]) {
    expect(source).not.toContain(forbidden);
  }
});

test("the client posts only to this app's own API route", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../components/BookingForm.tsx", import.meta.url), "utf8");

  const fetchTargets = [...source.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]);

  expect(fetchTargets.length).toBeGreaterThan(0);
  for (const target of fetchTargets) {
    expect(target).toMatch(/^\/api\//);
  }
});
