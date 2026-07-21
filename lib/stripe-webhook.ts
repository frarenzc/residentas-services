import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { getStripeClient } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { StripeAccountKey } from '@/lib/stripe-routing';

// Phase 3D.1 — shared Stripe webhook handler used by both account endpoints
// (/api/stripe/webhook/rmi and /api/stripe/webhook/activos-reais). Each endpoint
// passes its own account key; this module resolves that account's signing secret
// and Stripe client, so signatures are verified against the correct account and
// there is no dynamic env swapping.

const WEBHOOK_SECRET_ENV: Record<StripeAccountKey, string> = {
  rmi: 'STRIPE_WEBHOOK_SECRET_RMI',
  activos_reais: 'STRIPE_WEBHOOK_SECRET_ACTIVOS_REAIS',
};

// Rebuild the booking row from Stripe session metadata + payment result.
function bookingFromSession(
  session: Stripe.Checkout.Session,
  accountKey: StripeAccountKey
): Record<string, unknown> {
  const m = (session.metadata ?? {}) as Record<string, string>;
  const booking: Record<string, unknown> = { ...m };

  // Coerce numeric columns that were stored as strings in metadata.
  if (m.durationMins !== undefined) booking.durationMins = Number(m.durationMins);
  if (m.price !== undefined) booking.price = Number(m.price);

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  booking.payment_status = 'paid';
  booking.payment_currency = (session.currency ?? 'eur').toUpperCase();
  booking.payment_amount = session.amount_total ?? null; // minor units
  booking.stripe_checkout_session_id = session.id;
  booking.stripe_payment_intent_id = paymentIntentId;
  booking.paid_at = new Date().toISOString();

  // The endpoint that verified the signature is the authoritative source of the
  // account, so override whatever came through metadata.
  booking.stripe_account_key = accountKey;

  return booking;
}

export async function handleStripeWebhook(
  request: NextRequest,
  accountKey: StripeAccountKey
): Promise<NextResponse> {
  const signature = request.headers.get('stripe-signature');
  const envName = WEBHOOK_SECRET_ENV[accountKey];
  const webhookSecret = process.env[envName];

  if (!signature || !webhookSecret || webhookSecret.startsWith('REPLACE_WITH')) {
    console.error(`Stripe webhook not configured (missing signature or ${envName}).`);
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 400 });
  }

  // Raw body is required for signature verification.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripeClient(accountKey).webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error(`Stripe webhook signature verification failed (${accountKey})`, err);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    // Acknowledge unrelated events so Stripe doesn't retry them.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Only fulfil truly-paid sessions.
  if (session.payment_status !== 'paid') {
    return NextResponse.json({ received: true, note: 'session not paid' });
  }

  const ref = session.metadata?.ref;
  if (!ref) {
    console.error('checkout.session.completed missing metadata.ref', session.id);
    return NextResponse.json({ received: true, note: 'no ref in metadata' });
  }

  // Idempotency: if this booking or Stripe session already exists, do nothing
  // (duplicate/replayed webhook).
  const { data: existing, error: existErr } = await supabaseAdmin
    .from('bookings')
    .select('ref,stripe_checkout_session_id')
    .or(`ref.eq.${ref},stripe_checkout_session_id.eq.${session.id}`)
    .limit(1);
  if (existErr) {
    console.error('Webhook existence check failed', existErr);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
  if (existing && existing.length > 0) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const booking = bookingFromSession(session, accountKey);

  // Insert the paid booking (service role → bypasses RLS; fires the
  // booking_created audit trigger automatically).
  const { error: insertErr } = await supabaseAdmin.from('bookings').insert(booking);
  if (insertErr) {
    // 23505 = unique_violation → a concurrent duplicate webhook already inserted it.
    if ((insertErr as { code?: string }).code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error(`Webhook booking insert failed for ${ref}`, insertErr);
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 });
  }

  // Append the payment_received audit event (booking_created is logged by the trigger).
  const amountMinor = session.amount_total ?? 0;
  const currency = (session.currency ?? 'eur').toUpperCase();
  const { error: eventErr } = await supabaseAdmin.from('booking_events').insert({
    booking_ref: ref,
    event_type: 'payment_received',
    old_value: null,
    new_value: `${currency} ${(amountMinor / 100).toFixed(2)}`,
    created_by: `stripe:${accountKey}`,
  });
  if (eventErr) {
    // Booking is paid + stored; don't fail the webhook over the audit row.
    console.error(`payment_received audit insert failed for ${ref}`, eventErr);
  }

  return NextResponse.json({ received: true, ref, account: accountKey });
}
