import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// SERVER-ONLY Supabase client using the service-role key.
// NEVER import this from a Client Component or anything bundled to the browser.
// The service-role key bypasses RLS, so it must stay on the server.
//
// Migrated from Guest Services. One deliberate difference: the client is
// created lazily on first use rather than at module load. The source threw at
// import time, which would fail `next build` and the test suite on any machine
// without the secrets present. The error messages and runtime behaviour are
// unchanged — a missing key still throws clearly, just at the point of use.

let client: SupabaseClient | null = null;

function createAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  }
  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local (server-only, NOT prefixed with NEXT_PUBLIC).",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!client) client = createAdminClient();
  return client;
}

/** Test seam: drop the cached client so stubbed env vars are re-read. */
export function resetSupabaseAdminForTests(): void {
  client = null;
}

/**
 * Same shape as the Guest Services export, so call sites read identically
 * (`supabaseAdmin.from('bookings')`). Property access is what triggers
 * construction, keeping import-time side effects at zero.
 */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, property, receiver) {
    return Reflect.get(getSupabaseAdmin(), property, receiver);
  },
});
