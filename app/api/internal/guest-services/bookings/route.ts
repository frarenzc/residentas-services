import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const MAX_BOOKINGS = 50;
const BASE_BOOKING_FIELDS =
  'ref,guest,type,hotel,submittedAt,status,arrival,price,direction,arrivalTime,pickupTime,' +
  // Phase 6.0: full read-only detail fields (all columns on public.bookings; no
  // joins, no Stripe/Supabase ids, no Stripe metadata).
  'room,pax,email,phone,flight,arrivalFlight,departureFlight,origin,destination,' +
  'departure,bagsCheckin,bagsCabin,childSeats,route,durationMins,notes,' +
  'payment_currency,payment_amount,paid_at';
// Phase 6.1: expose property_code (canonical property identifier, added in Phase
// 3D.1). Non-sensitive; NOT an internal id or credential. Kept in the optional
// tier alongside payment_status so a DB predating either column still responds.
const OPTIONAL_BOOKING_FIELDS = ['payment_status', 'property_code'] as const;
const BOOKING_FIELDS_WITH_PAYMENT = `${BASE_BOOKING_FIELDS},${OPTIONAL_BOOKING_FIELDS.join(',')}`;

type BookingRow = {
  ref: string | null;
  guest: string | null;
  type: string | null;
  hotel: string | null;
  submittedAt: string | null;
  status: string | null;
  arrival: string | null;
  price: number | string | null;
  direction: string | null;
  arrivalTime: string | null;
  pickupTime: string | null;
  // Phase 6.0 detail fields.
  room: string | null;
  pax: number | string | null;
  email: string | null;
  phone: string | null;
  flight: string | null;
  arrivalFlight: string | null;
  departureFlight: string | null;
  origin: string | null;
  destination: string | null;
  departure: string | null;
  bagsCheckin: string | null;
  bagsCabin: string | null;
  childSeats: string | null;
  route: string | null;
  durationMins: number | null;
  notes: string | null;
  payment_currency: string | null;
  payment_amount: number | null;
  paid_at: string | null;
  payment_status?: string | null;
  property_code?: string | null;
};

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isAuthorized(request: NextRequest): boolean {
  const expectedToken = process.env.GUEST_SERVICES_API_TOKEN;
  const providedToken = getBearerToken(request);

  if (!expectedToken || !providedToken) {
    return false;
  }

  const expectedHash = crypto.createHash('sha256').update(expectedToken).digest();
  const providedHash = crypto.createHash('sha256').update(providedToken).digest();

  return crypto.timingSafeEqual(expectedHash, providedHash);
}

// A missing optional column (payment_status / property_code) surfaces as
// Postgres 42703 (undefined_column). Older databases that predate either
// migration must still return the base payload.
function isMissingOptionalColumn(error: { code?: string; message?: string }) {
  return error.code === '42703' || OPTIONAL_BOOKING_FIELDS.some((f) => new RegExp(f, 'i').test(error.message ?? ''));
}

async function readBookings() {
  const query = supabaseAdmin
    .from('bookings')
    .select(BOOKING_FIELDS_WITH_PAYMENT)
    .order('submittedAt', { ascending: false })
    .limit(MAX_BOOKINGS);

  const { data, error } = await query;

  if (!error || !isMissingOptionalColumn(error)) {
    return { data: data as BookingRow[] | null, error };
  }

  // Fallback: select only the guaranteed base columns and null the optional ones.
  const fallback = await supabaseAdmin
    .from('bookings')
    .select(BASE_BOOKING_FIELDS)
    .order('submittedAt', { ascending: false })
    .limit(MAX_BOOKINGS);

  return {
    data:
      (fallback.data as BookingRow[] | null)?.map((booking) => ({
        ...booking,
        payment_status: null,
        property_code: null,
      })) ?? null,
    error: fallback.error,
  };
}

function sanitizeBooking(booking: BookingRow) {
  return {
    reference: booking.ref,
    guest: booking.guest,
    serviceType: booking.type,
    property: booking.hotel,
    submittedDate: booking.submittedAt,
    status: booking.status ?? 'pending',
    arrivalDate: booking.arrival,
    paymentStatus: booking.payment_status ?? null,
    price: booking.price,
    // Scheduling fields: the Hub derives a service time from these the same way
    // the /staff dashboard does (tuk-tuk and apt->airport use pickupTime,
    // otherwise arrivalTime).
    direction: booking.direction,
    arrivalTime: booking.arrivalTime,
    pickupTime: booking.pickupTime,
    // Phase 6.0: full read-only detail. Operational contact info (email/phone)
    // is exposed for the authenticated Hub detail view, matching /staff.
    room: booking.room,
    pax: booking.pax,
    email: booking.email,
    phone: booking.phone,
    flight: booking.flight,
    arrivalFlight: booking.arrivalFlight,
    departureFlight: booking.departureFlight,
    origin: booking.origin,
    destination: booking.destination,
    departureDate: booking.departure,
    bagsCheckin: booking.bagsCheckin,
    bagsCabin: booking.bagsCabin,
    childSeats: booking.childSeats,
    route: booking.route,
    durationMins: booking.durationMins,
    guestNotes: booking.notes,
    paymentCurrency: booking.payment_currency,
    paymentAmount: booking.payment_amount, // minor units (cents)
    paidAt: booking.paid_at,
    // Phase 6.1: canonical property code (e.g. "arco"). Read-only, non-sensitive.
    propertyCode: booking.property_code ?? null,
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorized();
  }

  const { data, error } = await readBookings();

  if (error) {
    console.error('Internal Guest Services bookings read failed', error);
    return NextResponse.json({ error: 'Read failed' }, { status: 500 });
  }

  return NextResponse.json({ bookings: (data ?? []).map(sanitizeBooking) });
}
