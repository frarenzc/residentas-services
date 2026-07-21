import { NextRequest, NextResponse } from 'next/server';

import { getStripeClient } from '@/lib/stripe';
import { resolveReturnUrls } from '@/lib/checkout-return';
import { CURRENCY, computePriceEuros, normalizePricingInput, serviceLabel, toMinorUnits } from '@/lib/pricing';
import { propertyCodeFromHotel, routeAccount } from '@/lib/stripe-routing';

export const runtime = 'nodejs';

// Build the booking record server-side from the raw form payload.
// Price is intentionally NOT taken from the client.
function buildBooking(body: Record<string, unknown>) {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const service = body.service === 'tuktuk' ? 'tuktuk' : 'transfer';

  const first = s(body.firstName);
  const last = s(body.lastName);
  const hotel = s(body.hotel);
  const email = s(body.email);
  const phone = s(body.phone);

  if (!first || !last || !hotel) return { error: 'Please fill in your first name, last name, and apartment.' };
  if (!email && !phone) return { error: 'Please provide at least an email or phone number.' };

  const ref = 'RES-' + Date.now().toString(36).toUpperCase().slice(-6);
  const booking: Record<string, unknown> = {
    ref,
    type: service,
    guest: `${first} ${last}`,
    room: s(body.room),
    email,
    phone,
    hotel,
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };

  if (service === 'transfer') {
    const pax = Number(body.pax);
    const direction = s(body.direction) || 'airport-apt';
    if (!pax) return { error: 'Please select the number of passengers.' };
    booking.direction = direction;
    booking.pax = String(pax);
    booking.bagsCheckin = s(body.bagsCheckin);
    booking.bagsCabin = s(body.bagsCabin);
    booking.childSeats = s(body.childSeats);
    booking.notes = s(body.transferNotes);
    if (direction === 'airport-apt') {
      booking.arrival = s(body.arrDate);
      booking.flight = s(body.arrFlight);
      booking.arrivalTime = s(body.arrTime);
      booking.origin = s(body.arrOrigin);
    } else if (direction === 'apt-airport') {
      booking.departure = s(body.depDate);
      booking.flight = s(body.depFlight);
      booking.pickupTime = s(body.depPickup);
      booking.destination = s(body.depDest);
    } else {
      booking.arrival = s(body.bthArrDate);
      booking.arrivalFlight = s(body.bthArrFlight);
      booking.arrivalTime = s(body.bthArrTime);
      booking.origin = s(body.bthArrOrigin);
      booking.departure = s(body.bthDepDate);
      booking.departureFlight = s(body.bthDepFlight);
      booking.pickupTime = s(body.bthDepPickup);
      booking.destination = s(body.bthDepDest);
    }
  } else {
    const tuktukDate = s(body.tuktukDate);
    if (!tuktukDate) return { error: 'Please select a date for the tour.' };
    booking.arrival = tuktukDate;
    booking.pickupTime = s(body.tuktukTime);
    booking.pax = s(body.tuktukPax) || '?';
    booking.route = s(body.route);
    booking.durationMins = body.durationMins != null ? Number(body.durationMins) : undefined;
    booking.notes = s(body.tuktukNotes);
  }

  // Authoritative price (whole euros). Never trust the client.
  // Normalised through the shared helper so the read-only quote endpoint and
  // checkout can never disagree on what a payload costs.
  const priceEuros = computePriceEuros(
    normalizePricingInput({
      service,
      pax: booking.pax as string,
      direction: booking.direction as string,
      durationMins: booking.durationMins as number,
    })
  );
  if (priceEuros == null || priceEuros <= 0) return { error: 'Could not determine a price for this selection.' };
  booking.price = priceEuros;

  // Phase 3D.1: resolve which Stripe account this payment routes to, from the
  // apartment. Persisted into the booking (and thus Stripe session metadata) so
  // the webhook can store it on the final row.
  const propertyCode = propertyCodeFromHotel(hotel);
  booking.property_code = propertyCode;
  booking.stripe_account_key = routeAccount(propertyCode);

  return { booking, priceEuros, ref };
}

// Flatten the booking to Stripe metadata: string values only, drop empties,
// cap notes. Stripe allows <=50 keys, <=500 chars per value.
function toMetadata(booking: Record<string, unknown>): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(booking)) {
    if (v === undefined || v === null || v === '') continue;
    let str = String(v);
    if (k === 'notes') str = str.slice(0, 450);
    else str = str.slice(0, 480);
    meta[k] = str;
  }
  return meta;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const built = buildBooking(body);
  if ('error' in built) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }
  const { booking, priceEuros, ref } = built;

  // Where Stripe returns the guest. The browser names a destination; the
  // origins and paths are server-controlled. `checkoutSource` is used ONLY here
  // and is deliberately not added to the booking or to Stripe metadata, since
  // the webhook spreads metadata straight into the bookings insert.
  const { successUrl, cancelUrl } = resolveReturnUrls(body.checkoutSource, ref);

  let session;
  try {
    // Phase 3D.1: route to the correct Stripe account (RMI vs Activos Reais).
    const stripe = getStripeClient(booking.stripe_account_key as 'rmi' | 'activos_reais');
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: toMinorUnits(priceEuros), // minor units
            product_data: {
              name: `${serviceLabel({ service: booking.type as 'transfer' | 'tuktuk' })} — ${booking.hotel}`,
              description: `Residentas service booking ${ref}`,
            },
          },
        },
      ],
      ...(booking.email ? { customer_email: booking.email as string } : {}),
      client_reference_id: ref,
      metadata: toMetadata(booking),
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  } catch (err) {
    console.error('Stripe Checkout Session creation failed', err);
    return NextResponse.json({ error: 'Payment could not be started. Please try again.' }, { status: 500 });
  }

  if (!session.url) {
    return NextResponse.json({ error: 'Payment could not be started.' }, { status: 500 });
  }
  return NextResponse.json({ url: session.url, ref });
}
