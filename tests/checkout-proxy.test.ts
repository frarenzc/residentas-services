import { test, expect, vi, beforeEach, afterEach } from "vitest";

import { POST } from "@/app/api/checkout/route";
import { buildCheckoutPayload, parseCheckoutResult } from "@/lib/checkoutPayload";
import { PROPERTIES } from "@/lib/catalog";

// Upstream is always mocked. No live Stripe, Supabase or Guest Services call.
const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_placeholder";
const fetchMock = vi.fn();

const VALID_BOOKING = {
  service: "transfer",
  firstName: "Ana",
  lastName: "Lopes",
  email: "ana@example.com",
  phone: "+351912345678",
  hotel: PROPERTIES[0],
  room: "12A",
  pax: 2,
  direction: "both",
  arrDate: "2026-09-01",
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GUEST_SERVICES_BASE_URL", "http://guest-services.test");
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ url: STRIPE_URL, ref: "RES-ABC123" }), { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function checkout(body: unknown) {
  return POST(
    new Request("http://localhost:3002/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** The JSON body the proxy sent upstream. */
function sentPayload(): Record<string, unknown> {
  const init = fetchMock.mock.calls.at(-1)![1] as RequestInit;
  return JSON.parse(init.body as string);
}

// --- forwarding rules ---

test("a valid booking is handed off and the Stripe URL returned", async () => {
  const response = await checkout(VALID_BOOKING);
  const json = await response.json();

  expect(response.status).toBe(200);
  expect(json).toEqual({ ok: true, url: STRIPE_URL, ref: "RES-ABC123" });
  expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(
    "http://guest-services.test/api/checkout/create-session",
  );
});

test("the proxy stamps checkoutSource itself", async () => {
  await checkout(VALID_BOOKING);
  expect(sentPayload().checkoutSource).toBe("residentas-services");
});

test("the browser cannot override checkoutSource", async () => {
  await checkout({ ...VALID_BOOKING, checkoutSource: "legacy-book" });
  expect(sentPayload().checkoutSource).toBe("residentas-services");
});

test("return URLs, account keys, Stripe ids and price overrides are never forwarded", async () => {
  await checkout({
    ...VALID_BOOKING,
    success_url: "https://evil.example",
    successUrl: "https://evil.example",
    cancel_url: "https://evil.example",
    returnOrigin: "https://evil.example",
    returnPath: "/pwned",
    redirect_uri: "https://evil.example",
    stripe_account_key: "rmi",
    account: "rmi",
    stripe_checkout_session_id: "cs_test_1",
    price: 1,
    amount: 1,
    amountMinor: 1,
    estimatedTotal: 1,
    unit_amount: 1,
    currency: "usd",
    quote: { estimatedTotal: 1 },
    metadata: { evil: "yes" },
    property_code: "arco",
  });

  const payload = sentPayload();
  const serialised = JSON.stringify(payload);

  for (const forbidden of [
    "success_url", "successUrl", "cancel_url", "returnOrigin", "returnPath", "redirect_uri",
    "stripe_account_key", "account", "stripe_checkout_session_id", "price", "amount",
    "amountMinor", "estimatedTotal", "unit_amount", "currency", "quote", "metadata", "property_code",
  ]) {
    expect(payload, forbidden).not.toHaveProperty(forbidden);
  }
  expect(serialised).not.toContain("evil.example");
  expect(serialised).not.toContain("usd");
});

test("only allowlisted booking fields plus checkoutSource are sent", async () => {
  await checkout({ ...VALID_BOOKING, somethingInvented: "x", __proto__: { polluted: true } });

  const keys = Object.keys(sentPayload());
  expect(keys).not.toContain("somethingInvented");
  expect(keys).not.toContain("polluted");
  // Booking data the guest actually entered still travels.
  expect(sentPayload().firstName).toBe("Ana");
  expect(sentPayload().hotel).toBe(PROPERTIES[0]);
});

test("buildCheckoutPayload always wins over a caller-supplied source", () => {
  expect(buildCheckoutPayload({ checkoutSource: "anything" }).checkoutSource).toBe("residentas-services");
  expect(buildCheckoutPayload(null).checkoutSource).toBe("residentas-services");
});

// --- validation before handoff ---

test("an incomplete booking is rejected without contacting Guest Services", async () => {
  const response = await checkout({ service: "transfer" });

  expect(response.status).toBe(400);
  expect((await response.json()).errors).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("malformed JSON is rejected safely", async () => {
  const response = await POST(
    new Request("http://localhost:3002/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }),
  );

  expect(response.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

// --- upstream response handling ---

test("a malformed upstream response never becomes a redirect", async () => {
  for (const bad of [
    {},
    { url: STRIPE_URL },
    { ref: "RES-1" },
    { url: "", ref: "RES-1" },
    { url: "not-a-url", ref: "RES-1" },
    { url: "http://checkout.stripe.com/x", ref: "RES-1" }, // not https
    { url: "https://evil.example/pay", ref: "RES-1" }, // not Stripe
    { url: "javascript:alert(1)", ref: "RES-1" },
    { url: STRIPE_URL, ref: "" },
  ]) {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(bad), { status: 200 }));
    const response = await checkout(VALID_BOOKING);
    const json = await response.json();

    expect(response.status, JSON.stringify(bad)).toBe(502);
    expect(json.ok).toBe(false);
    expect(json.url).toBeUndefined();
  }
});

test("parseCheckoutResult only accepts a genuine Stripe https URL", () => {
  expect(parseCheckoutResult({ url: STRIPE_URL, ref: "R" })).toEqual({ url: STRIPE_URL, ref: "R" });
  expect(parseCheckoutResult({ url: "https://evil.example", ref: "R" })).toBeNull();
  expect(parseCheckoutResult(null)).toBeNull();
});

test("an upstream timeout produces a friendly error", async () => {
  fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
  const response = await checkout(VALID_BOOKING);
  const json = await response.json();

  expect(response.status).toBe(502);
  expect(json.error).toBe("Checkout is temporarily unavailable. Please try again in a moment.");
  expect(JSON.stringify(json)).not.toMatch(/timed out|TimeoutError|guest-services\.test/i);
});

test("an upstream outage never leaks raw errors or the upstream host", async () => {
  for (const failure of [
    () => fetchMock.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:3000")),
    () => fetchMock.mockResolvedValue(new Response("<html>502</html>", { status: 502 })),
    () => fetchMock.mockResolvedValue(new Response("nope", { status: 500 })),
  ]) {
    failure();
    const json = await (await checkout(VALID_BOOKING)).json();

    expect(json.error).toBe("Checkout is temporarily unavailable. Please try again in a moment.");
    expect(JSON.stringify(json)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|html|guest-services\.test/i);
  }
});

test("an upstream 400 surfaces the guest-safe message", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: "Could not determine a price for this selection." }), { status: 400 }),
  );
  const response = await checkout(VALID_BOOKING);
  const json = await response.json();

  expect(response.status).toBe(400);
  expect(json.error).toBe("Could not determine a price for this selection.");
});

// --- secrets and privacy ---

test("the upstream base URL and any token never reach the client", async () => {
  const body = JSON.stringify(await (await checkout(VALID_BOOKING)).json());

  expect(body).not.toContain("guest-services.test");
  expect(body).not.toMatch(/authorization|bearer|token|secret|GUEST_SERVICES/i);
});

test("the checkout route imports no Stripe or Supabase SDK and logs no payload", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  for (const forbidden of ["stripe", "supabase", "STRIPE_SECRET", "SERVICE_ROLE", "Bearer"]) {
    expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
  }
  // Nothing may log the booking, the body or a guest field.
  expect(code).not.toMatch(/console\.(log|error|warn)\([^)]*\b(booking|body|payload|data|values|email|phone)\b/);
});

test("no guest data is written to the console during a failed checkout", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock.mockRejectedValue(new Error("boom"));

  await checkout(VALID_BOOKING);

  const logged = spy.mock.calls.flat().map(String).join(" ");
  for (const pii of ["Ana", "Lopes", "ana@example.com", "351912345678", "12A", PROPERTIES[0]]) {
    expect(logged, pii).not.toContain(pii);
  }
  spy.mockRestore();
});
