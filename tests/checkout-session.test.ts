import { test, expect, vi, beforeEach, afterEach } from "vitest";

import { computePriceEuros, toMinorUnits } from "@/lib/pricing";

// Checkout session creation now happens in this application. Stripe is mocked
// throughout — no live Stripe or Supabase call is made.
type SessionArgs = {
  line_items: { price_data: { unit_amount: number; currency: string; product_data: { name: string } } }[];
  metadata: Record<string, string>;
  success_url: string;
  cancel_url: string;
  client_reference_id: string;
  customer_email?: string;
};

const createSession = vi.fn<(args: SessionArgs) => Promise<{ url: string | null }>>(async () => ({
  url: "https://checkout.stripe.com/c/pay/cs_test_placeholder",
}));

const getStripeClient = vi.fn<(account: string) => { checkout: { sessions: { create: typeof createSession } } }>(
  () => ({ checkout: { sessions: { create: createSession } } }),
);

vi.mock("@/lib/stripe", () => ({ getStripeClient: (account: string) => getStripeClient(account) }));

const { POST } = await import("@/app/api/checkout/create-session/route");

const SITE_ORIGIN = "https://services.example";

const VALID = {
  service: "transfer",
  firstName: "Ana",
  lastName: "Lopes",
  hotel: "Residentas Áurea",
  email: "ana@example.com",
  pax: 2,
  direction: "both",
  arrDate: "2026-09-01",
};

beforeEach(() => {
  createSession.mockClear();
  getStripeClient.mockClear();
  createSession.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_test_placeholder" });
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE_ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function checkout(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  const request = new Request("http://localhost:3002/api/checkout/create-session", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ ...VALID, ...payload }),
  });
  const response = await POST(request as never);
  return { status: response.status, json: await response.json() };
}

function session(): SessionArgs {
  return createSession.mock.calls.at(-1)![0];
}

// --- response contract ---

test("a valid booking returns exactly { url, ref }", async () => {
  const { status, json } = await checkout({});

  expect(status).toBe(200);
  expect(Object.keys(json).sort()).toEqual(["ref", "url"]);
  expect(json.url).toBe("https://checkout.stripe.com/c/pay/cs_test_placeholder");
  expect(json.ref).toMatch(/^RES-[0-9A-Z]+$/);
});

test("the reference is generated server-side and echoed into the session", async () => {
  const { json } = await checkout({});

  expect(session().client_reference_id).toBe(json.ref);
  expect(session().metadata.ref).toBe(json.ref);
});

// --- authoritative pricing ---

for (const pax of [2, 3, 4, 5]) {
  for (const direction of ["airport-apt", "apt-airport", "both"]) {
    test(`charges the authoritative price for ${pax} pax ${direction}`, async () => {
      await checkout({ service: "transfer", pax, direction });
      const expected = computePriceEuros({ service: "transfer", pax, direction }) as number;

      expect(session().line_items[0].price_data.unit_amount).toBe(toMinorUnits(expected));
      expect(session().line_items[0].price_data.currency).toBe("eur");
    });
  }
}

for (const durationMins of [60, 90, 120, 180, 240, 480]) {
  test(`charges the authoritative price for a ${durationMins}-minute tour`, async () => {
    await checkout({ service: "tuktuk", durationMins, tuktukDate: "2026-09-01" });
    const expected = computePriceEuros({ service: "tuktuk", durationMins }) as number;

    expect(session().line_items[0].price_data.unit_amount).toBe(toMinorUnits(expected));
  });
}

test("a client-submitted price or quote cannot alter the charged amount", async () => {
  await checkout({});
  const honest = session().line_items[0].price_data.unit_amount;

  await checkout({
    price: 1, amount: 1, amountMinor: 1, estimatedTotal: 1, unit_amount: 1,
    currency: "usd", quote: { estimatedTotal: 1 },
  });

  expect(session().line_items[0].price_data.unit_amount).toBe(honest);
  expect(session().line_items[0].price_data.currency).toBe("eur");
});

test("a blank direction defaults before pricing", async () => {
  await checkout({ direction: "" });

  expect(session().line_items[0].price_data.unit_amount).toBe(
    toMinorUnits(computePriceEuros({ service: "transfer", pax: 2, direction: "airport-apt" }) as number),
  );
});

// --- Stripe account routing ---

test("Arco do Bandeira routes to the RMI account, everything else to Activos Reais", async () => {
  await checkout({ hotel: "Residentas Arco do Bandeira" });
  expect(getStripeClient).toHaveBeenLastCalledWith("rmi");
  expect(session().metadata.stripe_account_key).toBe("rmi");
  expect(session().metadata.property_code).toBe("arco");

  for (const hotel of ["Residentas Áurea", "Residentas São Pedro", "Residentas Apóstolos"]) {
    await checkout({ hotel });
    expect(getStripeClient, hotel).toHaveBeenLastCalledWith("activos_reais");
    expect(session().metadata.stripe_account_key, hotel).toBe("activos_reais");
  }
});

test("an unknown property routes to Activos Reais rather than RMI", async () => {
  await checkout({ hotel: "Some New Apartment" });

  expect(getStripeClient).toHaveBeenLastCalledWith("activos_reais");
  expect(session().metadata.property_code).not.toBe("arco");
});

// --- return URLs ---

test("checkout returns the guest to this application", async () => {
  const { json } = await checkout({});

  expect(session().success_url).toBe(`${SITE_ORIGIN}/success?ref=${encodeURIComponent(json.ref)}`);
  expect(session().cancel_url).toBe(`${SITE_ORIGIN}/cancel`);
});

test("browser-supplied return URLs and origins are ignored", async () => {
  await checkout({
    checkoutSource: "https://evil.example",
    success_url: "https://evil.example/win",
    successUrl: "https://evil.example/win",
    cancel_url: "https://evil.example/lose",
    returnOrigin: "https://evil.example",
    returnPath: "/pwned",
  });

  expect(new URL(session().success_url).origin).toBe(SITE_ORIGIN);
  expect(new URL(session().cancel_url).origin).toBe(SITE_ORIGIN);
  expect(`${session().success_url} ${session().cancel_url}`).not.toContain("evil.example");
});

test("Host, Origin, Referer and forwarded headers cannot steer the redirect", async () => {
  await checkout({}, {
    host: "evil.example",
    origin: "https://evil.example",
    referer: "https://evil.example/page",
    "x-forwarded-host": "evil.example",
  });

  expect(new URL(session().success_url).origin).toBe(SITE_ORIGIN);
  expect(new URL(session().cancel_url).origin).toBe(SITE_ORIGIN);
});

test("only the booking reference appears in a return URL", async () => {
  await checkout({});
  const combined = `${session().success_url} ${session().cancel_url}`;

  expect([...new URL(session().success_url).searchParams.keys()]).toEqual(["ref"]);
  for (const pii of ["Ana", "Lopes", "ana@example.com", "Áurea", "email", "phone"]) {
    expect(combined, pii).not.toContain(pii);
  }
});

// --- validation ---

test("identity validation is enforced before any Stripe call", async () => {
  for (const invalid of [
    { firstName: "" },
    { lastName: "" },
    { hotel: "" },
    { email: "", phone: "" },
  ]) {
    createSession.mockClear();
    const { status } = await checkout(invalid);

    expect(status, JSON.stringify(invalid)).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  }
});

test("an unpriceable selection is rejected", async () => {
  createSession.mockClear();
  const { status, json } = await checkout({ pax: 9 });

  expect(status).toBe(400);
  expect(json.error).toMatch(/price/i);
  expect(createSession).not.toHaveBeenCalled();
});

test("a tuk-tuk without a date is rejected", async () => {
  createSession.mockClear();
  const { status } = await checkout({ service: "tuktuk", durationMins: 120, tuktukDate: "" });

  expect(status).toBe(400);
  expect(createSession).not.toHaveBeenCalled();
});

test("malformed JSON is rejected safely", async () => {
  const response = await POST(
    new Request("http://localhost:3002/api/checkout/create-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }) as never,
  );

  expect(response.status).toBe(400);
});

// --- metadata / webhook compatibility ---

test("metadata carries the fields the webhook persists", async () => {
  await checkout({ room: "12A", phone: "+351912345678" });
  const metadata = session().metadata;

  for (const key of ["ref", "type", "guest", "hotel", "email", "status", "price", "submittedAt", "property_code", "stripe_account_key"]) {
    expect(metadata, key).toHaveProperty(key);
  }
  expect(metadata.status).toBe("pending");
  expect(metadata.type).toBe("transfer");
  expect(metadata.guest).toBe("Ana Lopes");
  // Every metadata value must be a string for Stripe.
  for (const value of Object.values(metadata)) {
    expect(typeof value).toBe("string");
  }
});

test("no checkout-source or return-URL key leaks into metadata", async () => {
  // The webhook spreads metadata straight into the bookings insert, so an
  // unknown key would fail the insert AFTER the guest has paid.
  await checkout({ checkoutSource: "residentas-services" });

  for (const key of Object.keys(session().metadata)) {
    expect(key, key).not.toMatch(/checkout_?source|success|cancel|return|redirect/i);
  }
});

test("empty values are dropped from metadata", async () => {
  await checkout({ room: "", phone: "" });

  expect(session().metadata).not.toHaveProperty("room");
  expect(session().metadata).not.toHaveProperty("phone");
});

// --- Stripe failure handling ---

test("a Stripe failure yields a friendly 500 and no url", async () => {
  createSession.mockRejectedValue(new Error("card_declined: raw stripe detail"));
  const { status, json } = await checkout({});

  expect(status).toBe(500);
  expect(json.error).toBe("Payment could not be started. Please try again.");
  expect(JSON.stringify(json)).not.toMatch(/card_declined|raw stripe detail/);
});

test("a session without a url is treated as a failure", async () => {
  createSession.mockResolvedValue({ url: null });
  const { status, json } = await checkout({});

  expect(status).toBe(500);
  expect(json.url).toBeUndefined();
});

// --- independence ---

test("checkout needs no Guest Services base URL", async () => {
  vi.stubEnv("GUEST_SERVICES_BASE_URL", "");
  const { status } = await checkout({});

  expect(status).toBe(200);
});

test("the checkout route source references no Guest Services deployment", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../app/api/checkout/create-session/route.ts", import.meta.url),
    "utf8",
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  expect(code).not.toContain("GUEST_SERVICES_BASE_URL");
  expect(code).not.toContain("fetch(");
});
