import { NextRequest, NextResponse } from "next/server";

import { isValid, normalizeBooking, validateBooking } from "@/lib/bookingSchema";

export const runtime = "nodejs";

// Public server-side validation boundary for the booking form.
//
// Phase 1 scope: this endpoint re-validates whatever the browser submits and
// returns safe, user-friendly field errors. It deliberately does NOT create a
// booking and does NOT start a payment — Stripe Checkout is not yet wired to
// this application (see README "Checkout status"). Nothing here simulates a
// successful payment.
//
// Guest Services remains the source of truth for pricing, Stripe Checkout,
// booking persistence and webhooks. This app holds no Stripe secret, no
// Supabase credentials and no internal staff API token.

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const booking = normalizeBooking(body);
  const errors = validateBooking(booking);

  if (!isValid(errors)) {
    return NextResponse.json(
      { ok: false, error: "Please correct the highlighted fields.", errors },
      { status: 400 },
    );
  }

  // Validated only. No booking row is created and no payment is started, so we
  // must not imply either happened.
  return NextResponse.json({
    ok: true,
    status: "validated",
    checkoutEnabled: false,
    message:
      "Your details are valid. Online payment is not yet enabled on this address — please continue on the existing booking page.",
    service: booking.service,
  });
}
