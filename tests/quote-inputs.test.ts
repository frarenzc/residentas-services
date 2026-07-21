import { test, expect } from "vitest";

import { parseQuote, quoteInputsFor, quoteQuery, formatQuoteTotal } from "@/lib/quote";
import { EMPTY_BOOKING } from "@/lib/bookingSchema";

// Representative arbitrary amounts. These are NOT the real Guest Services
// prices — this app must never contain a pricing table, not even in tests.
const QUOTE = {
  currency: "eur",
  estimatedTotal: 42,
  amountMinor: 4200,
  breakdown: [{ label: "Airport Transfer — Both ways, 2 passengers", quantity: 1, unitPrice: 42, amount: 42 }],
  quotedAt: "2026-07-21T10:00:00.000Z",
  isEstimate: true,
};

// --- which inputs are sent ---

test("a transfer quote sends only service, pax and direction", () => {
  const inputs = quoteInputsFor({ ...EMPTY_BOOKING, service: "transfer", pax: 3, direction: "both" });

  expect(inputs).toEqual({ service: "transfer", pax: 3, direction: "both" });
  expect(new URLSearchParams(quoteQuery(inputs!)).size).toBe(3);
});

test("a tuk-tuk quote sends only service and durationMins", () => {
  const inputs = quoteInputsFor({ ...EMPTY_BOOKING, service: "tuktuk", durationMins: 120 });

  expect(inputs).toEqual({ service: "tuktuk", durationMins: 120 });
  expect(new URLSearchParams(quoteQuery(inputs!)).size).toBe(2);
});

test("no personal, itinerary or luggage field can reach the quote query", () => {
  const loaded = {
    ...EMPTY_BOOKING,
    service: "transfer",
    pax: 2,
    direction: "both",
    firstName: "Ana",
    lastName: "Lopes",
    email: "ana@example.com",
    phone: "+351912345678",
    hotel: "Residentas Arco do Bandeira",
    room: "12A",
    arrDate: "2026-09-01",
    arrFlight: "TP123",
    bagsCheckin: "5",
    childSeats: "2",
    transferNotes: "please be quiet",
  };

  const query = quoteQuery(quoteInputsFor(loaded)!);

  expect([...new URLSearchParams(query).keys()].sort()).toEqual(["direction", "pax", "service"]);
  for (const leak of ["Ana", "Lopes", "example.com", "351912345678", "Arco", "12A", "TP123", "quiet"]) {
    expect(query, leak).not.toContain(leak);
  }
});

// --- when a quote is requested at all ---

test("no quote is requested until the pricing inputs are complete", () => {
  expect(quoteInputsFor({ ...EMPTY_BOOKING, service: "transfer", pax: null })).toBeNull();
  expect(quoteInputsFor({ ...EMPTY_BOOKING, service: "tuktuk", durationMins: null })).toBeNull();
  expect(quoteInputsFor({ ...EMPTY_BOOKING, service: "unknown" })).toBeNull();
});

test("a blank direction falls back to the default rather than blocking the quote", () => {
  const inputs = quoteInputsFor({ ...EMPTY_BOOKING, service: "transfer", pax: 2, direction: "" });
  expect(inputs).toEqual({ service: "transfer", pax: 2, direction: "airport-apt" });
});

test("a complete tuk-tuk selection is priceable without any transfer field", () => {
  expect(quoteInputsFor({ ...EMPTY_BOOKING, service: "tuktuk", durationMins: 60, pax: null })).not.toBeNull();
});

// --- response parsing ---

test("a well-formed quote is accepted intact", () => {
  const parsed = parseQuote(QUOTE);

  expect(parsed).toEqual(QUOTE);
  expect(parsed!.amountMinor).toBe(QUOTE.amountMinor);
  expect(parsed!.currency).toBe(QUOTE.currency);
});

test("malformed or hostile payloads are rejected instead of rendered", () => {
  const bad: unknown[] = [
    null,
    undefined,
    "a string",
    42,
    [],
    {},
    { ...QUOTE, currency: "" },
    { ...QUOTE, estimatedTotal: "42" },
    { ...QUOTE, estimatedTotal: 0 },
    { ...QUOTE, estimatedTotal: -5 },
    { ...QUOTE, amountMinor: null },
    { ...QUOTE, quotedAt: 0 },
    { ...QUOTE, isEstimate: "yes" },
    { ...QUOTE, breakdown: [] },
    { ...QUOTE, breakdown: "none" },
    { ...QUOTE, breakdown: [{ label: "x" }] },
    { ...QUOTE, breakdown: [{ label: "", quantity: 1, unitPrice: 1, amount: 1 }] },
  ];

  for (const payload of bad) {
    expect(parseQuote(payload), JSON.stringify(payload)).toBeNull();
  }
});

test("the amount shown is the amount returned, never recomputed", () => {
  // A deliberately inconsistent payload: amountMinor is NOT total * 100. The
  // parser must pass it through untouched rather than "correcting" it.
  const parsed = parseQuote({ ...QUOTE, amountMinor: 999 });
  expect(parsed!.amountMinor).toBe(999);
});

test("the total is formatted with the currency the API returned", () => {
  expect(formatQuoteTotal(parseQuote(QUOTE)!)).toContain("42");
  expect(formatQuoteTotal(parseQuote({ ...QUOTE, currency: "usd" })!)).toContain("42");
});

// --- no pricing table anywhere in this app ---

test("the pricing tables never reach the browser", async () => {
  // Pricing now lives in this app (lib/pricing.ts) and is evaluated server-side
  // by /api/quote and the checkout route. What still must not happen is a price
  // table being bundled into client code, where a guest could edit it.
  const { readFile, readdir } = await import("node:fs/promises");
  const roots = ["app/", "components/", "lib/"].map((dir) => new URL(`../${dir}`, import.meta.url));

  async function sources(dir: URL): Promise<URL[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const found: URL[] = [];
    for (const entry of entries) {
      if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) found.push(...(await sources(child)));
      else if (/\.(ts|tsx|css)$/.test(entry.name)) found.push(child);
    }
    return found;
  }

  let scanned = 0;
  let pricingModules = 0;

  for (const root of roots) {
    for (const file of await sources(root)) {
      scanned += 1;
      const source = await readFile(file, "utf8");
      const isClient = source.includes('"use client"') || source.includes("'use client'");
      const holdsTables = /TRANSFER_PRICES|TUKTUK_PRICES|PRICE_TABLE/.test(source);

      if (holdsTables) {
        pricingModules += 1;
        expect(file.pathname, "price tables belong only in lib/pricing.ts").toMatch(/lib\/pricing\.ts$/);
      }

      if (isClient) {
        // No client component may pull in the pricing module or its tables.
        expect(source, `${file.pathname}: client bundle must not import pricing`).not.toMatch(
          /@\/lib\/pricing|TRANSFER_PRICES|TUKTUK_PRICES|computePriceEuros/,
        );
      }
    }
  }

  // Guard against the scan silently walking nothing.
  expect(scanned).toBeGreaterThan(5);
  expect(pricingModules, "expected exactly one pricing module").toBe(1);
});
