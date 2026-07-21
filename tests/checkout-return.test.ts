import { test, expect, vi, afterEach } from "vitest";

import { resolveReturnUrls, CheckoutReturnConfigError } from "@/lib/checkout-return";

// Placeholder origins only. No real environment value is read.
const PROD_ORIGIN = "https://services.residentas.com";

afterEach(() => {
  vi.unstubAllEnvs();
});

function inProduction(siteUrl: string) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
}

function inDevelopment(siteUrl: string) {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
}

// --- valid production URL ---

test("a valid https production origin resolves both return URLs", () => {
  inProduction(PROD_ORIGIN);
  const { successUrl, cancelUrl } = resolveReturnUrls(undefined, "RES-ABC123");

  expect(successUrl).toBe(`${PROD_ORIGIN}/success?ref=RES-ABC123`);
  expect(cancelUrl).toBe(`${PROD_ORIGIN}/cancel`);
});

test("a trailing slash on the origin does not produce a double slash", () => {
  inProduction(`${PROD_ORIGIN}/`);
  expect(resolveReturnUrls(undefined, "R").successUrl).toBe(`${PROD_ORIGIN}/success?ref=R`);
});

test("the reference is percent-encoded and is the only query parameter", () => {
  inProduction(PROD_ORIGIN);
  const { successUrl, cancelUrl } = resolveReturnUrls(undefined, "RES A&B=1");

  expect(new URL(successUrl).searchParams.get("ref")).toBe("RES A&B=1");
  expect([...new URL(successUrl).searchParams.keys()]).toEqual(["ref"]);
  expect(new URL(cancelUrl).search).toBe("");
});

// --- missing variable ---

test("a missing NEXT_PUBLIC_SITE_URL fails loudly in production", () => {
  inProduction("");
  expect(() => resolveReturnUrls(undefined, "R")).toThrow(CheckoutReturnConfigError);
  expect(() => resolveReturnUrls(undefined, "R")).toThrow(/NEXT_PUBLIC_SITE_URL is not set/);
});

test("a whitespace-only value counts as missing", () => {
  inProduction("   ");
  expect(() => resolveReturnUrls(undefined, "R")).toThrow(/not set/);
});

test("a missing variable fails in development too, rather than guessing", () => {
  inDevelopment("");
  expect(() => resolveReturnUrls(undefined, "R")).toThrow(CheckoutReturnConfigError);
});

// --- malformed URL ---

test("a malformed URL is rejected", () => {
  for (const bad of ["services.residentas.com", "not a url", "://nope", "http//missing-colon"]) {
    inProduction(bad);
    expect(() => resolveReturnUrls(undefined, "R"), bad).toThrow(CheckoutReturnConfigError);
  }
});

test("a non-http(s) scheme is rejected", () => {
  for (const bad of ["javascript:alert(1)", "ftp://services.residentas.com", "data:text/html,x"]) {
    inProduction(bad);
    expect(() => resolveReturnUrls(undefined, "R"), bad).toThrow(/https/);
  }
});

// --- HTTP URL ---

test("a plain http production origin is rejected", () => {
  inProduction("http://services.residentas.com");
  expect(() => resolveReturnUrls(undefined, "R")).toThrow(/must use https/);
});

test("localhost is rejected in production", () => {
  for (const local of ["http://localhost:3002", "http://127.0.0.1:3002"]) {
    inProduction(local);
    expect(() => resolveReturnUrls(undefined, "R"), local).toThrow(/not valid in production/);
  }
});

test("production never silently falls back to localhost", () => {
  // The regression this fix exists for: every bad value used to yield
  // http://localhost:3002 with no signal.
  for (const bad of ["", "http://services.residentas.com", "services.residentas.com", `${PROD_ORIGIN}/book`]) {
    inProduction(bad);
    let resolved: string | null = null;
    try {
      resolved = resolveReturnUrls(undefined, "R").successUrl;
    } catch {
      // expected
    }
    expect(resolved, `${bad} produced a URL instead of throwing`).toBeNull();
  }
});

// --- trailing path ---

test("an origin carrying a path is rejected", () => {
  inProduction(`${PROD_ORIGIN}/book`);
  expect(() => resolveReturnUrls(undefined, "R")).toThrow(/no path/);
});

test("an origin carrying a query or fragment is rejected", () => {
  inProduction(`${PROD_ORIGIN}?x=1`);
  expect(() => resolveReturnUrls(undefined, "R")).toThrow(/no query string or fragment/);

  inProduction(`${PROD_ORIGIN}#frag`);
  expect(() => resolveReturnUrls(undefined, "R")).toThrow(/no query string or fragment/);
});

// --- localhost development ---

test("http localhost is accepted outside production", () => {
  inDevelopment("http://localhost:3002");
  const { successUrl, cancelUrl } = resolveReturnUrls(undefined, "RES-DEV");

  expect(successUrl).toBe("http://localhost:3002/success?ref=RES-DEV");
  expect(cancelUrl).toBe("http://localhost:3002/cancel");
});

test("127.0.0.1 is accepted outside production", () => {
  inDevelopment("http://127.0.0.1:3002");
  expect(resolveReturnUrls(undefined, "R").successUrl).toBe("http://127.0.0.1:3002/success?ref=R");
});

test("a non-local http origin is rejected even in development", () => {
  inDevelopment("http://services.residentas.com");
  expect(() => resolveReturnUrls(undefined, "R")).toThrow(/must use https/);
});

test("https still works in development", () => {
  inDevelopment(PROD_ORIGIN);
  expect(resolveReturnUrls(undefined, "R").successUrl).toBe(`${PROD_ORIGIN}/success?ref=R`);
});

// --- browser URL manipulation ---

test("no caller-supplied value can influence the destination", () => {
  inProduction(PROD_ORIGIN);

  const attacks: unknown[] = [
    "https://evil.example",
    "//evil.example",
    "javascript:alert(1)",
    "legacy-book\r\nLocation: https://evil.example",
    "../../../evil",
    { successUrl: "https://evil.example", cancelUrl: "https://evil.example" },
    ["https://evil.example"],
    { toString: () => "https://evil.example" },
    null,
    undefined,
    42,
  ];

  const expected = resolveReturnUrls(undefined, "RES-1");

  for (const attack of attacks) {
    const actual = resolveReturnUrls(attack, "RES-1");

    expect(actual, JSON.stringify(attack)).toEqual(expected);
    expect(new URL(actual.successUrl).origin).toBe(PROD_ORIGIN);
    expect(`${actual.successUrl} ${actual.cancelUrl}`).not.toContain("evil.example");
    expect(actual.successUrl).not.toContain("javascript:");
  }
});

test("no personal data can appear in a return URL", () => {
  inProduction(PROD_ORIGIN);
  const { successUrl, cancelUrl } = resolveReturnUrls(undefined, "RES-ABC123");
  const combined = `${successUrl} ${cancelUrl}`;

  for (const field of ["email", "phone", "firstName", "lastName", "hotel", "guest", "price", "amount"]) {
    expect(combined.toLowerCase(), field).not.toContain(field.toLowerCase());
  }
});
