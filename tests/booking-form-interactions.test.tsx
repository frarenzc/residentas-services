// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

import BookingForm, { openPickerForInput } from "@/components/BookingForm";
import { POST } from "@/app/api/checkout/create-session/route";

const createSession = vi.fn(async () => ({
  url: "https://checkout.stripe.com/c/pay/cs_test_placeholder",
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({ checkout: { sessions: { create: createSession } } }),
}));

beforeEach(() => {
  createSession.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://services.example");
});

function metadata() {
  const call = createSession.mock.calls.at(-1) as unknown as [{ metadata: Record<string, string> }] | undefined;
  if (!call) throw new Error("Stripe checkout session was not created.");
  return call[0].metadata;
}

async function checkout(payload: Record<string, unknown>) {
  const request = new Request("http://localhost:3002/api/checkout/create-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      service: "transfer",
      firstName: "QA",
      lastName: "Guest",
      hotel: "Residentas Áurea",
      email: "qa@example.test",
      pax: 2,
      direction: "airport-apt",
      ...payload,
    }),
  });

  return POST(request as never);
}

test("default booking form uses native date and time inputs without duplicate custom picker icons", () => {
  const html = renderToStaticMarkup(createElement(BookingForm));

  expect(html).toContain('type="date"');
  expect(html).toContain('type="time"');
  expect(html).not.toContain("picker-button");
  expect(html).not.toContain("📅");
  expect(html).not.toContain("🕘");
});

test("picker helper falls back to focus when native picker is unavailable", () => {
  const focus = vi.fn();
  openPickerForInput({ focus } as unknown as HTMLInputElement);
  expect(focus).toHaveBeenCalledTimes(1);
});

test("transfer date and time selections reach checkout metadata without shifting", async () => {
  const response = await checkout({
    direction: "both",
    bthArrDate: "2026-03-29",
    bthArrTime: "01:30",
    bthDepDate: "2026-10-25",
    bthDepPickup: "02:15",
  });

  expect(response.status).toBe(200);
  expect(metadata()).toMatchObject({
    arrival: "2026-03-29",
    arrivalTime: "01:30",
    departure: "2026-10-25",
    pickupTime: "02:15",
  });
});

test("tuk-tuk date and time selections reach checkout metadata without shifting", async () => {
  const response = await checkout({
    service: "tuktuk",
    durationMins: 120,
    tuktukDate: "2026-03-29",
    tuktukTime: "01:30",
  });

  expect(response.status).toBe(200);
  expect(metadata()).toMatchObject({
    arrival: "2026-03-29",
    pickupTime: "01:30",
  });
});
