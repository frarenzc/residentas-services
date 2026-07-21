import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// The internal Guest Services API now lives on the PUBLIC booking host, so its
// bearer boundary is the only thing standing between the open internet and
// every guest's contact details and itinerary. These tests exercise each route
// handler directly. Supabase is mocked — no database call is made.

const TOKEN = "test-token-placeholder";

vi.mock("@/lib/supabaseAdmin", () => {
  // Terminal calls resolve to an empty result; every other chain method returns
  // the builder. A Proxy keeps this robust as the routes' queries evolve —
  // these tests are about the auth gate, not query shape.
  const TERMINAL = new Set(["limit", "single", "maybeSingle", "insert", "then", "csv"]);

  const builder: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return undefined; // not a thenable
        if (TERMINAL.has(prop)) return async () => ({ data: prop === "limit" ? [] : null, error: null });
        return () => builder;
      },
    },
  );

  const client = { from: () => builder };
  return { supabaseAdmin: client, getSupabaseAdmin: () => client, resetSupabaseAdminForTests: () => {} };
});

type Handler = (request: NextRequest) => Promise<Response>;

async function handlers(): Promise<{ name: string; method: string; fn: Handler }[]> {
  const [bookings, events, notes, status, reports] = await Promise.all([
    import("@/app/api/internal/guest-services/bookings/route"),
    import("@/app/api/internal/guest-services/bookings/events/route"),
    import("@/app/api/internal/guest-services/bookings/notes/route"),
    import("@/app/api/internal/guest-services/bookings/status/route"),
    import("@/app/api/internal/guest-services/reports/route"),
  ]);

  return [
    { name: "bookings", method: "GET", fn: bookings.GET as Handler },
    { name: "bookings/events", method: "GET", fn: events.GET as Handler },
    { name: "bookings/notes", method: "GET", fn: notes.GET as Handler },
    { name: "bookings/notes", method: "PATCH", fn: notes.PATCH as Handler },
    { name: "bookings/status", method: "PATCH", fn: status.PATCH as Handler },
    { name: "reports", method: "GET", fn: reports.GET as Handler },
  ];
}

function request(method: string, headers: Record<string, string> = {}): NextRequest {
  // The routes read `request.nextUrl`, so they need a real NextRequest rather
  // than a bare Request.
  return new NextRequest(
    "https://services.residentas.com/api/internal/guest-services/bookings?ref=RES-ABC123&reference=RES-ABC123",
    {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(method === "GET"
        ? {}
        : { body: JSON.stringify({ ref: "RES-ABC123", status: "confirmed", notes: "x" }) }),
    },
  );
}

beforeEach(() => {
  vi.stubEnv("GUEST_SERVICES_API_TOKEN", TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("every internal route rejects a request with no Authorization header", async () => {
  for (const { name, method, fn } of await handlers()) {
    const response = await fn(request(method));
    expect(response.status, `${method} ${name}`).toBe(401);
  }
});

test("every internal route rejects a wrong or malformed token", async () => {
  const bad = [
    { authorization: "Bearer wrong-token" },
    { authorization: "Bearer " },
    { authorization: TOKEN }, // missing the Bearer scheme
    { authorization: `Basic ${TOKEN}` },
    { authorization: `Bearer ${TOKEN}extra` },
    { authorization: `Bearer ${TOKEN.slice(0, -1)}` },
  ];

  for (const { name, method, fn } of await handlers()) {
    for (const headers of bad) {
      const response = await fn(request(method, headers));
      expect(response.status, `${method} ${name} :: ${headers.authorization}`).toBe(401);
    }
  }
});

test("a correct token is accepted (not 401)", async () => {
  for (const { name, method, fn } of await handlers()) {
    const response = await fn(request(method, { authorization: `Bearer ${TOKEN}` }));
    // Downstream may 400 on the mocked payload, but it must clear the auth gate.
    expect(response.status, `${method} ${name}`).not.toBe(401);
  }
});

test("an unconfigured server token rejects everything rather than allowing it", async () => {
  vi.stubEnv("GUEST_SERVICES_API_TOKEN", "");

  for (const { name, method, fn } of await handlers()) {
    const response = await fn(request(method, { authorization: "Bearer anything" }));
    expect(response.status, `${method} ${name}`).toBe(401);
  }
});

test("a 401 body never leaks configuration or guest data", async () => {
  for (const { method, fn } of await handlers()) {
    const response = await fn(request(method));
    const body = JSON.stringify(await response.json().catch(() => ({})));

    expect(body).not.toContain(TOKEN);
    expect(body.toLowerCase()).not.toMatch(/supabase|service_role|stripe|sk_|postgres/);
  }
});
