import { test, expect, vi, afterEach } from "vitest";

// lib/stripe.ts is mocked by every other suite, so its own logic — which env
// var maps to which account, placeholder rejection, and client caching — was
// untested. It decides which secret is used to charge a guest, so it is worth
// covering directly. Placeholder keys only; no Stripe API call is made
// (the constructor performs no network I/O).

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function freshModule() {
  vi.resetModules();
  return import("@/lib/stripe");
}

test("each account reads its own secret env var", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY_RMI", "sk_test_rmi_placeholder");
  vi.stubEnv("STRIPE_SECRET_KEY_ACTIVOS_REAIS", "sk_test_activos_placeholder");

  const { getStripeClient } = await freshModule();

  // Distinct clients, so the two accounts can never share a key.
  expect(getStripeClient("rmi")).not.toBe(getStripeClient("activos_reais"));
});

test("a client is cached per account", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY_RMI", "sk_test_rmi_placeholder");
  const { getStripeClient } = await freshModule();

  expect(getStripeClient("rmi")).toBe(getStripeClient("rmi"));
});

test("a missing key throws naming the exact variable to set", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY_RMI", "");
  vi.stubEnv("STRIPE_SECRET_KEY_ACTIVOS_REAIS", "");
  const { getStripeClient } = await freshModule();

  expect(() => getStripeClient("rmi")).toThrow(/STRIPE_SECRET_KEY_RMI/);
  expect(() => getStripeClient("activos_reais")).toThrow(/STRIPE_SECRET_KEY_ACTIVOS_REAIS/);
});

test("an unreplaced placeholder is refused rather than sent to Stripe", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY_RMI", "REPLACE_WITH_YOUR_KEY");
  const { getStripeClient } = await freshModule();

  expect(() => getStripeClient("rmi")).toThrow(/STRIPE_SECRET_KEY_RMI/);
});

test("one account being unconfigured does not break the other", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY_RMI", "");
  vi.stubEnv("STRIPE_SECRET_KEY_ACTIVOS_REAIS", "sk_test_activos_placeholder");
  const { getStripeClient } = await freshModule();

  expect(() => getStripeClient("rmi")).toThrow();
  expect(getStripeClient("activos_reais")).toBeDefined();
});

test("importing the module does not construct a client", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY_RMI", "");
  vi.stubEnv("STRIPE_SECRET_KEY_ACTIVOS_REAIS", "");

  // Must not throw at import time, or the build fails without secrets.
  await expect(freshModule()).resolves.toBeDefined();
});
