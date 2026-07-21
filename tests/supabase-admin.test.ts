import { test, expect, vi, afterEach } from "vitest";

// The webhook suite mocks @/lib/supabaseAdmin, so the real module — and in
// particular the lazy Proxy that replaced Guest Services' eager construction —
// was never exercised. These tests cover it directly with placeholder values.
// No network call is made: createClient and .from() are local operations.

afterEach(async () => {
  const { resetSupabaseAdminForTests } = await import("@/lib/supabaseAdmin");
  resetSupabaseAdminForTests();
  vi.unstubAllEnvs();
  vi.resetModules();
});

function stubValidEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://placeholder.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "placeholder-service-role-key");
}

test("importing the module has no side effect when env is absent", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

  // Guest Services threw here. This must not, or the build and tests break.
  await expect(import("@/lib/supabaseAdmin")).resolves.toBeDefined();
});

test("the proxied client supports the call shape the webhook uses", async () => {
  stubValidEnv();
  const { supabaseAdmin, resetSupabaseAdminForTests } = await import("@/lib/supabaseAdmin");
  resetSupabaseAdminForTests();

  // Exactly what lib/stripe-webhook.ts does, minus awaiting the request.
  const builder = supabaseAdmin.from("bookings").select("ref,stripe_checkout_session_id");
  expect(builder).toBeDefined();
  expect(typeof builder.or).toBe("function");
  expect(typeof builder.limit).toBe("function");

  expect(typeof supabaseAdmin.from("bookings").insert).toBe("function");
});

test("a missing URL throws only when the client is used", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "placeholder-service-role-key");

  const { getSupabaseAdmin, resetSupabaseAdminForTests } = await import("@/lib/supabaseAdmin");
  resetSupabaseAdminForTests();

  expect(() => getSupabaseAdmin()).toThrow(/Missing NEXT_PUBLIC_SUPABASE_URL/);
});

test("a missing service-role key throws only when the client is used", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://placeholder.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

  const { getSupabaseAdmin, resetSupabaseAdminForTests } = await import("@/lib/supabaseAdmin");
  resetSupabaseAdminForTests();

  expect(() => getSupabaseAdmin()).toThrow(/Missing SUPABASE_SERVICE_ROLE_KEY/);
});

test("the client is constructed once and cached", async () => {
  stubValidEnv();
  const { getSupabaseAdmin, resetSupabaseAdminForTests } = await import("@/lib/supabaseAdmin");
  resetSupabaseAdminForTests();

  expect(getSupabaseAdmin()).toBe(getSupabaseAdmin());
});
