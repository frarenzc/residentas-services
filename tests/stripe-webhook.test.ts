import { test, expect, vi, beforeEach, afterEach } from "vitest";

// Webhook processing now happens in this application. Stripe signature
// verification and Supabase are both mocked — no live call is made.

const constructEvent = vi.fn();
const getStripeClient = vi.fn<(account: string) => { webhooks: { constructEvent: typeof constructEvent } }>(
  () => ({ webhooks: { constructEvent } }),
);

vi.mock("@/lib/stripe", () => ({ getStripeClient: (account: string) => getStripeClient(account) }));

// Minimal Supabase query-builder double that records what was written.
const inserted: { table: string; row: Record<string, unknown> }[] = [];
let existingRows: unknown[] = [];
let existErr: unknown = null;
let insertErr: unknown = null;

function makeQuery(table: string) {
  const builder = {
    select: () => builder,
    or: () => builder,
    limit: async () => ({ data: existingRows, error: existErr }),
    insert: async (row: Record<string, unknown>) => {
      if (!insertErr) inserted.push({ table, row });
      return { error: insertErr };
    },
  };
  return builder;
}

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: (table: string) => makeQuery(table) },
  getSupabaseAdmin: () => ({ from: (table: string) => makeQuery(table) }),
  resetSupabaseAdminForTests: () => {},
}));

const { handleStripeWebhook } = await import("@/lib/stripe-webhook");

const SESSION = {
  id: "cs_test_123",
  payment_status: "paid",
  currency: "eur",
  amount_total: 5500,
  payment_intent: "pi_test_123",
  metadata: {
    ref: "RES-ABC123",
    type: "transfer",
    guest: "Ana Lopes",
    hotel: "Residentas Áurea",
    email: "ana@example.com",
    price: "55",
    durationMins: "120",
    status: "pending",
    property_code: "aurea",
    stripe_account_key: "activos_reais",
  },
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    type: "checkout.session.completed",
    data: { object: { ...SESSION, ...overrides } },
  };
}

function request() {
  return new Request("http://localhost:3002/api/stripe/webhook/rmi", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=placeholder" },
    body: "{}",
  }) as never;
}

beforeEach(() => {
  inserted.length = 0;
  existingRows = [];
  existErr = null;
  insertErr = null;
  constructEvent.mockReset();
  getStripeClient.mockClear();
  constructEvent.mockReturnValue(event());
  vi.stubEnv("STRIPE_WEBHOOK_SECRET_RMI", "whsec_placeholder");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET_ACTIVOS_REAIS", "whsec_placeholder");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// --- persistence ---

test("a paid session is persisted as a booking", async () => {
  const response = await handleStripeWebhook(request(), "rmi");
  const json = await response.json();

  expect(response.status).toBe(200);
  expect(json).toMatchObject({ received: true, ref: "RES-ABC123", account: "rmi" });

  const booking = inserted.find((row) => row.table === "bookings")!.row;
  expect(booking.ref).toBe("RES-ABC123");
  expect(booking.payment_status).toBe("paid");
  expect(booking.payment_amount).toBe(5500);
  expect(booking.payment_currency).toBe("EUR");
  expect(booking.stripe_checkout_session_id).toBe("cs_test_123");
  expect(booking.stripe_payment_intent_id).toBe("pi_test_123");
  expect(booking.paid_at).toBeTruthy();
});

test("numeric metadata is coerced back to numbers", async () => {
  await handleStripeWebhook(request(), "rmi");
  const booking = inserted.find((row) => row.table === "bookings")!.row;

  expect(booking.price).toBe(55);
  expect(booking.durationMins).toBe(120);
});

test("the verifying endpoint is authoritative for the Stripe account", async () => {
  // Metadata claims activos_reais; the RMI endpoint verified it, so RMI wins.
  await handleStripeWebhook(request(), "rmi");
  const booking = inserted.find((row) => row.table === "bookings")!.row;

  expect(booking.stripe_account_key).toBe("rmi");
});

test("a payment_received audit event is appended", async () => {
  await handleStripeWebhook(request(), "activos_reais");
  const audit = inserted.find((row) => row.table === "booking_events")!.row;

  expect(audit).toMatchObject({
    booking_ref: "RES-ABC123",
    event_type: "payment_received",
    new_value: "EUR 55.00",
    created_by: "stripe:activos_reais",
  });
});

test("each account endpoint verifies with its own client", async () => {
  await handleStripeWebhook(request(), "rmi");
  expect(getStripeClient).toHaveBeenLastCalledWith("rmi");

  await handleStripeWebhook(request(), "activos_reais");
  expect(getStripeClient).toHaveBeenLastCalledWith("activos_reais");
});

// --- duplicate protection / idempotency ---

test("a replayed webhook does not insert a second booking", async () => {
  existingRows = [{ ref: "RES-ABC123", stripe_checkout_session_id: "cs_test_123" }];

  const response = await handleStripeWebhook(request(), "rmi");
  const json = await response.json();

  expect(json).toMatchObject({ received: true, duplicate: true });
  expect(inserted.filter((row) => row.table === "bookings")).toHaveLength(0);
});

test("a concurrent duplicate insert is absorbed via the unique violation", async () => {
  insertErr = { code: "23505" };

  const response = await handleStripeWebhook(request(), "rmi");
  const json = await response.json();

  expect(response.status).toBe(200);
  expect(json).toMatchObject({ received: true, duplicate: true });
});

test("an existence-check failure surfaces as a 500 so Stripe retries", async () => {
  existErr = { message: "db down" };

  const response = await handleStripeWebhook(request(), "rmi");

  expect(response.status).toBe(500);
  expect(inserted.filter((row) => row.table === "bookings")).toHaveLength(0);
});

test("a genuine insert failure returns 500 so Stripe retries", async () => {
  insertErr = { code: "42703", message: "column does not exist" };

  const response = await handleStripeWebhook(request(), "rmi");
  const json = await response.json();

  expect(response.status).toBe(500);
  expect(json.error).toBe("Insert failed");
});

// --- events that must not create bookings ---

test("an unpaid session is ignored", async () => {
  constructEvent.mockReturnValue(event({ payment_status: "unpaid" }));

  const response = await handleStripeWebhook(request(), "rmi");

  expect((await response.json()).note).toBe("session not paid");
  expect(inserted).toHaveLength(0);
});

test("a session without a reference is ignored", async () => {
  constructEvent.mockReturnValue(event({ metadata: {} }));

  const response = await handleStripeWebhook(request(), "rmi");

  expect((await response.json()).note).toBe("no ref in metadata");
  expect(inserted).toHaveLength(0);
});

test("unrelated event types are acknowledged without writing", async () => {
  constructEvent.mockReturnValue({ type: "payment_intent.created", data: { object: {} } });

  const response = await handleStripeWebhook(request(), "rmi");
  const json = await response.json();

  expect(json).toMatchObject({ received: true, ignored: "payment_intent.created" });
  expect(inserted).toHaveLength(0);
});

// --- signature verification ---

test("an invalid signature is rejected and writes nothing", async () => {
  constructEvent.mockImplementation(() => {
    throw new Error("No signatures found matching the expected signature");
  });

  const response = await handleStripeWebhook(request(), "rmi");
  const json = await response.json();

  expect(response.status).toBe(400);
  expect(json.error).toBe("Invalid signature.");
  expect(inserted).toHaveLength(0);
});

test("a missing signature header is rejected", async () => {
  const unsigned = new Request("http://localhost:3002/api/stripe/webhook/rmi", {
    method: "POST",
    body: "{}",
  }) as never;

  const response = await handleStripeWebhook(unsigned, "rmi");

  expect(response.status).toBe(400);
  expect(constructEvent).not.toHaveBeenCalled();
});

test("an unconfigured or placeholder webhook secret refuses to process", async () => {
  for (const secret of ["", "REPLACE_WITH_YOUR_SECRET"]) {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET_RMI", secret);
    const response = await handleStripeWebhook(request(), "rmi");

    expect(response.status, secret).toBe(400);
    expect((await response.json()).error).toBe("Webhook not configured.");
  }
  expect(inserted).toHaveLength(0);
});

// --- route wiring ---

test("both account routes are wired to their own account key", async () => {
  const { readFile } = await import("node:fs/promises");

  const rmi = await readFile(new URL("../app/api/stripe/webhook/rmi/route.ts", import.meta.url), "utf8");
  const activos = await readFile(
    new URL("../app/api/stripe/webhook/activos-reais/route.ts", import.meta.url),
    "utf8",
  );

  expect(rmi).toContain("handleStripeWebhook(request, 'rmi')");
  expect(activos).toContain("handleStripeWebhook(request, 'activos_reais')");
  expect(rmi).toContain("runtime = 'nodejs'");
});
