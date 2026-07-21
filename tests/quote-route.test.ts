import { test, expect, vi, afterEach } from "vitest";

import { GET, POST, PUT, PATCH, DELETE } from "@/app/api/quote/route";
import { computePriceEuros, toMinorUnits, CURRENCY } from "@/lib/pricing";
import { parseQuote } from "@/lib/quote";

// The quote is now computed in this application. These tests must pass with no
// Guest Services deployment reachable and no GUEST_SERVICES_BASE_URL set.

const fetchMock = vi.fn(() => {
  throw new Error("the quote route must not make network calls");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function quote(query: string) {
  return GET(new Request(`http://localhost:3002/api/quote?${query}`));
}

async function body(query: string) {
  const response = await quote(query);
  return { status: response.status, json: await response.json(), response };
}

const DIRECTIONS = ["airport-apt", "apt-airport", "both"] as const;
const PAX = [2, 3, 4, 5] as const;
const DURATIONS = [60, 90, 120, 180, 240, 480] as const;

// --- independence from Guest Services ---

test("a quote is produced with no GUEST_SERVICES_BASE_URL configured", async () => {
  vi.stubEnv("GUEST_SERVICES_BASE_URL", "");
  const { status, json } = await body("service=transfer&pax=2&direction=both");

  expect(status).toBe(200);
  expect(json.quote.estimatedTotal).toBeGreaterThan(0);
});

test("the quote route performs no network call at all", async () => {
  vi.stubGlobal("fetch", fetchMock);
  await body("service=transfer&pax=2&direction=both");
  await body("service=tuktuk&durationMins=120");

  expect(fetchMock).not.toHaveBeenCalled();
});

test("the route source references neither Guest Services nor a base URL", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/quote/route.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  expect(code).not.toContain("GUEST_SERVICES_BASE_URL");
  expect(code).not.toContain("fetch(");
  expect(code.toLowerCase()).not.toContain("stripe");
  expect(code.toLowerCase()).not.toContain("supabase");
});

// --- pricing correctness ---

for (const pax of PAX) {
  for (const direction of DIRECTIONS) {
    test(`transfer ${pax} pax ${direction} matches the pricing module`, async () => {
      const { status, json } = await body(`service=transfer&pax=${pax}&direction=${direction}`);
      const expected = computePriceEuros({ service: "transfer", pax, direction });

      expect(status).toBe(200);
      expect(json.quote.estimatedTotal).toBe(expected);
      expect(json.quote.amountMinor).toBe(toMinorUnits(expected as number));
    });
  }
}

for (const durationMins of DURATIONS) {
  test(`tuk-tuk ${durationMins} minutes matches the pricing module`, async () => {
    const { status, json } = await body(`service=tuktuk&durationMins=${durationMins}`);
    const expected = computePriceEuros({ service: "tuktuk", durationMins });

    expect(status).toBe(200);
    expect(json.quote.estimatedTotal).toBe(expected);
    expect(json.quote.amountMinor).toBe(toMinorUnits(expected as number));
  });
}

test("an omitted or blank direction defaults to airport-apt", async () => {
  const omitted = await body("service=transfer&pax=2");
  const blank = await body("service=transfer&pax=2&direction=");
  const explicit = await body("service=transfer&pax=2&direction=airport-apt");

  expect(omitted.json.quote.estimatedTotal).toBe(explicit.json.quote.estimatedTotal);
  expect(blank.json.quote.estimatedTotal).toBe(explicit.json.quote.estimatedTotal);
  expect(omitted.json.quote.breakdown[0].label).toContain("Airport to Apartment");
});

// --- response contract ---

test("the payload still satisfies the client parser", async () => {
  const { json } = await body("service=transfer&pax=5&direction=both");

  const parsed = parseQuote(json.quote);
  expect(parsed).not.toBeNull();
  expect(parsed!.currency).toBe(CURRENCY);
  expect(parsed!.breakdown).toHaveLength(1);
});

test("the envelope and quote keys are unchanged", async () => {
  const { json } = await body("service=tuktuk&durationMins=120");

  expect(Object.keys(json).sort()).toEqual(["ok", "quote"]);
  expect(Object.keys(json.quote).sort()).toEqual(
    ["amountMinor", "breakdown", "currency", "estimatedTotal", "isEstimate", "quotedAt"].sort(),
  );
  expect(Object.keys(json.quote.breakdown[0]).sort()).toEqual(
    ["amount", "label", "quantity", "unitPrice"].sort(),
  );
});

test("the quote is flagged as an estimate, timestamped and cacheable", async () => {
  const { json, response } = await body("service=transfer&pax=2");

  expect(json.quote.isEstimate).toBe(true);
  expect(Number.isNaN(Date.parse(json.quote.quotedAt))).toBe(false);
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=300, stale-while-revalidate=600");
});

test("exactly one line item is returned and it totals the estimate", async () => {
  const { json } = await body("service=transfer&pax=5&direction=both");
  const line = json.quote.breakdown[0];

  expect(json.quote.breakdown).toHaveLength(1);
  expect(line.quantity).toBe(1);
  expect(line.unitPrice).toBe(json.quote.estimatedTotal);
  expect(line.amount).toBe(json.quote.estimatedTotal);
});

// --- invalid input ---

test("an unsupported service is rejected", async () => {
  for (const query of ["", "service=", "service=helicopter", "service=TRANSFER"]) {
    const { status, json } = await body(query);
    expect(status, query).toBe(400);
    expect(json.error.code, query).toBe("invalid_service");
  }
});

test("an invalid or missing passenger count is rejected", async () => {
  for (const pax of ["0", "1", "6", "3.5", "abc", ""]) {
    const { status, json } = await body(`service=transfer&pax=${pax}`);
    expect(status, `pax=${pax}`).toBe(400);
    expect(json.error.code, `pax=${pax}`).toBe("invalid_pax");
  }
  expect((await body("service=transfer")).json.error.code).toBe("invalid_pax");
});

test("an unrecognised direction is rejected", async () => {
  const { status, json } = await body("service=transfer&pax=2&direction=sideways");
  expect(status).toBe(400);
  expect(json.error.code).toBe("invalid_direction");
});

test("an invalid or missing duration is rejected", async () => {
  for (const duration of ["45", "0", "1000", "abc", ""]) {
    const { status, json } = await body(`service=tuktuk&durationMins=${duration}`);
    expect(status, `duration=${duration}`).toBe(400);
    expect(json.error.code, `duration=${duration}`).toBe("invalid_duration");
  }
  expect((await body("service=tuktuk")).json.error.code).toBe("invalid_duration");
});

test("errors never leak internals", async () => {
  const { json } = await body("service=transfer&pax=99");

  expect(Object.keys(json.error).sort()).toEqual(["code", "message"]);
  expect(JSON.stringify(json)).not.toMatch(/stripe|supabase|sk_|whsec_|postgres|guest-services/i);
});

// --- privacy ---

test("personal data in the query is ignored and never echoed", async () => {
  const { json } = await body(
    "service=transfer&pax=2&direction=both&firstName=Ana&email=ana@example.com&hotel=Arco",
  );
  const plain = await body("service=transfer&pax=2&direction=both");

  expect(json.quote.estimatedTotal).toBe(plain.json.quote.estimatedTotal);
  const serialised = JSON.stringify(json);
  for (const leak of ["Ana", "ana@example.com", "Arco"]) {
    expect(serialised, leak).not.toContain(leak);
  }
});

// --- methods ---

for (const [name, handler] of [
  ["POST", POST],
  ["PUT", PUT],
  ["PATCH", PATCH],
  ["DELETE", DELETE],
] as const) {
  test(`${name} returns 405`, async () => {
    const response = await handler();
    expect(response.status).toBe(405);
    expect((await response.json()).error.code).toBe("method_not_allowed");
  });
}
