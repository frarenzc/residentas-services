import { NextResponse } from "next/server";

import { isValid, normalizeBooking, validateBooking } from "@/lib/bookingSchema";
import { buildCheckoutPayload, parseCheckoutResult } from "@/lib/checkoutPayload";

export const runtime = "nodejs";

// Same-origin checkout proxy.
//
// The browser posts here; this route calls Guest Services server-to-server.
// Guest Services remains the sole creator of Stripe Checkout sessions — this
// app holds no Stripe credential and imports no Stripe SDK.
//
// GUEST_SERVICES_BASE_URL is server-only and never reaches the browser.
// Nothing here logs the booking payload or any guest field.

const UPSTREAM_TIMEOUT_MS = 10000;

function unavailable() {
  // Upstream detail is an operational concern, never a guest-facing one.
  return NextResponse.json(
    { ok: false, error: "Checkout is temporarily unavailable. Please try again in a moment." },
    { status: 502 },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  // Re-validate locally so an obviously incomplete booking never reaches
  // Guest Services. Guest Services validates authoritatively regardless.
  const booking = normalizeBooking(body);
  const errors = validateBooking(booking);
  if (!isValid(errors)) {
    return NextResponse.json(
      { ok: false, error: "Please correct the highlighted fields.", errors },
      { status: 400 },
    );
  }

  const baseUrl = process.env.GUEST_SERVICES_BASE_URL;
  if (!baseUrl) {
    console.error("GUEST_SERVICES_BASE_URL is not configured; cannot start checkout.");
    return unavailable();
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/checkout/create-session`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      // Rebuilt from an allowlist — the caller's raw body is never forwarded.
      body: JSON.stringify(buildCheckoutPayload(booking)),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Includes timeout and connection failure. No payload is logged.
    console.error("Checkout upstream request failed.");
    return unavailable();
  }

  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;

  if (!response.ok) {
    // Guest Services rejects an unpriceable or invalid booking with a 400 and a
    // guest-safe message; anything else is an outage on our side of the fence.
    if (response.status === 400 && typeof data?.error === "string") {
      return NextResponse.json({ ok: false, error: data.error }, { status: 400 });
    }
    return unavailable();
  }

  const result = parseCheckoutResult(data);
  if (!result) {
    console.error("Checkout upstream returned an unusable response.");
    return unavailable();
  }

  return NextResponse.json({ ok: true, url: result.url, ref: result.ref });
}
