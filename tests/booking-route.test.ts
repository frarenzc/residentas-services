import { test, expect } from "vitest";

import { POST } from "@/app/api/booking/route";
import { PROPERTIES } from "@/lib/catalog";

function post(body: unknown, raw?: string) {
  const request = new Request("http://localhost:3002/api/booking", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
  // The route only uses the standard Request surface.
  return POST(request as never);
}

const VALID_TRANSFER = {
  service: "transfer",
  firstName: "Ana",
  lastName: "Lopes",
  email: "ana@example.com",
  hotel: PROPERTIES[0],
  pax: 2,
  direction: "airport-apt",
  arrDate: "2026-09-01",
};

const VALID_TUKTUK = {
  service: "tuktuk",
  firstName: "Casey",
  lastName: "Silva",
  phone: "+351912345678",
  hotel: PROPERTIES[2],
  tuktukDate: "2026-09-01",
  durationMins: 120,
  route: "castle",
};

test("a valid transfer submission is accepted", async () => {
  const response = await post(VALID_TRANSFER);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.status).toBe("validated");
  expect(body.service).toBe("transfer");
});

test("a valid tuk-tuk submission is accepted", async () => {
  const response = await post(VALID_TUKTUK);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.service).toBe("tuktuk");
});

test("the response never claims a booking or a payment happened", async () => {
  const body = await (await post(VALID_TRANSFER)).json();

  expect(body.checkoutEnabled).toBe(false);
  expect(body).not.toHaveProperty("url");
  expect(body).not.toHaveProperty("ref");
  expect(body).not.toHaveProperty("sessionId");
  expect(JSON.stringify(body)).not.toMatch(/\b(paid|confirmed|booked)\b/i);
});

test("missing required fields are rejected with per-field errors", async () => {
  const response = await post({ service: "transfer" });
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.ok).toBe(false);
  expect(body.errors.firstName).toBeTruthy();
  expect(body.errors.lastName).toBeTruthy();
  expect(body.errors.hotel).toBeTruthy();
  expect(body.errors.email).toBeTruthy();
  expect(body.errors.pax).toBeTruthy();
});

test("an invalid email is rejected", async () => {
  const response = await post({ ...VALID_TRANSFER, email: "nope" });
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.errors.email).toBeTruthy();
});

test("a transfer missing its service-specific fields is rejected", async () => {
  const body = await (await post({ ...VALID_TRANSFER, pax: null })).json();
  expect(body.errors.pax).toBeTruthy();
});

test("a tuk-tuk missing its service-specific fields is rejected", async () => {
  const body = await (await post({ ...VALID_TUKTUK, tuktukDate: "", durationMins: null })).json();

  expect(body.errors.tuktukDate).toBeTruthy();
  expect(body.errors.durationMins).toBeTruthy();
});

test("malformed JSON is rejected without throwing", async () => {
  const response = await post(undefined, "{not json");

  expect(response.status).toBe(400);
  expect((await response.json()).ok).toBe(false);
});

test("junk body types are rejected, not crashed on", async () => {
  for (const junk of ["null", '"a string"', "42", "[]"]) {
    const response = await post(undefined, junk);
    expect(response.status).toBe(400);
  }
});

test("a client-supplied price is ignored, never echoed back", async () => {
  const body = await (await post({ ...VALID_TRANSFER, price: 1, amount: 1, total: 1 })).json();

  expect(body.ok).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/price|amount|total/i);
});

test("the route source contains no secrets and no internal staff endpoint call", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/booking/route.ts", import.meta.url), "utf8");

  for (const forbidden of ["STRIPE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "Bearer", "/api/internal/"]) {
    expect(source).not.toContain(forbidden);
  }
});
