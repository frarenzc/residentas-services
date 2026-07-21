import { test, expect, vi, beforeEach, afterEach } from "vitest";

import { GET } from "@/app/api/quote/route";

// Arbitrary representative amounts — not the real price table.
const UPSTREAM_QUOTE = {
  currency: "eur",
  estimatedTotal: 42,
  amountMinor: 4200,
  breakdown: [{ label: "Airport Transfer — Both ways, 2 passengers", quantity: 1, unitPrice: 42, amount: 42 }],
  quotedAt: "2026-07-21T10:00:00.000Z",
  isEstimate: true,
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GUEST_SERVICES_BASE_URL", "http://guest-services.test");
  fetchMock.mockResolvedValue(new Response(JSON.stringify(UPSTREAM_QUOTE), { status: 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function proxy(query: string) {
  return GET(new Request(`http://localhost:3002/api/quote?${query}`));
}

/** The upstream URL the proxy called. */
function upstreamUrl(): URL {
  return new URL(fetchMock.mock.calls.at(-1)![0] as string);
}

// --- forwarding ---

test("a valid transfer request reaches Guest Services with only pricing inputs", async () => {
  const response = await proxy("service=transfer&pax=2&direction=both");
  const json = await response.json();

  expect(response.status).toBe(200);
  expect(json.quote.amountMinor).toBe(UPSTREAM_QUOTE.amountMinor);
  expect(json.quote.currency).toBe(UPSTREAM_QUOTE.currency);

  const url = upstreamUrl();
  expect(url.origin).toBe("http://guest-services.test");
  expect(url.pathname).toBe("/api/quote");
  expect([...url.searchParams.keys()].sort()).toEqual(["direction", "pax", "service"]);
});

test("a valid tuk-tuk request sends only service and durationMins", async () => {
  await proxy("service=tuktuk&durationMins=120");

  expect([...upstreamUrl().searchParams.keys()].sort()).toEqual(["durationMins", "service"]);
});

test("personal fields appended by a caller are never relayed upstream", async () => {
  await proxy(
    "service=transfer&pax=2&direction=both&email=ana@example.com&firstName=Ana" +
      "&hotel=Residentas%20Arco%20do%20Bandeira&arrFlight=TP123&childSeats=2",
  );

  const url = upstreamUrl();
  expect([...url.searchParams.keys()].sort()).toEqual(["direction", "pax", "service"]);
  for (const leak of ["ana@example.com", "Ana", "Arco", "TP123"]) {
    expect(url.toString(), leak).not.toContain(leak);
  }
});

test("an omitted direction is defaulted before the request is made", async () => {
  await proxy("service=transfer&pax=2");
  expect(upstreamUrl().searchParams.get("direction")).toBe("airport-apt");
});

// --- validation before any network call ---

test("incomplete or invalid selections are rejected without calling Guest Services", async () => {
  for (const query of [
    "",
    "service=helicopter",
    "service=transfer",
    "service=transfer&pax=9",
    "service=transfer&pax=2&direction=sideways",
    "service=tuktuk",
    "service=tuktuk&durationMins=45",
  ]) {
    const response = await proxy(query);
    expect(response.status, query).toBe(400);
  }

  expect(fetchMock).not.toHaveBeenCalled();
});

// --- upstream failure handling ---

test("an upstream 400 is reported as an unpriceable selection", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: {} }), { status: 400 }));
  const response = await proxy("service=transfer&pax=2&direction=both");

  expect(response.status).toBe(400);
  expect((await response.json()).ok).toBe(false);
});

test("an upstream outage yields a friendly 502, never a raw error", async () => {
  for (const failure of [
    () => fetchMock.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:3000")),
    () => fetchMock.mockResolvedValue(new Response("gateway timeout", { status: 504 })),
    () => fetchMock.mockResolvedValue(new Response("<html>nope</html>", { status: 200 })),
    () => fetchMock.mockResolvedValue(new Response(JSON.stringify({ estimatedTotal: "free" }), { status: 200 })),
  ]) {
    failure();
    const response = await proxy("service=transfer&pax=2&direction=both");
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json.error).toBe("Estimated pricing is temporarily unavailable.");
    expect(JSON.stringify(json)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|html|stack/i);
  }
});

test("a missing base URL fails safely instead of calling an undefined host", async () => {
  vi.stubEnv("GUEST_SERVICES_BASE_URL", "");
  const response = await proxy("service=transfer&pax=2&direction=both");

  expect(response.status).toBe(502);
  expect(fetchMock).not.toHaveBeenCalled();
});

// --- the proxy holds no secrets ---

test("the proxy route never exposes the upstream base URL or any token", async () => {
  const response = await proxy("service=transfer&pax=2&direction=both");
  const body = JSON.stringify(await response.json());

  expect(body).not.toContain("guest-services.test");
  expect(body).not.toMatch(/authorization|bearer|token|secret/i);

  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/quote/route.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/Bearer|API_TOKEN|SERVICE_ROLE|STRIPE/);
  expect(source).not.toContain("NEXT_PUBLIC_GUEST_SERVICES");
});
