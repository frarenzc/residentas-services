import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const ALLOWED_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'] as const;
const ALLOWED_BODY_KEYS = new Set(['reference', 'status']);
const BOOKING_FIELDS =
  'ref,guest,type,hotel,submittedAt,status,arrival,price,direction,arrivalTime,pickupTime,payment_status';

type BookingStatus = (typeof ALLOWED_STATUSES)[number];

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
  payment_status?: string | null;
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

function isSupportedStatus(value: string): value is BookingStatus {
  return ALLOWED_STATUSES.includes(value as BookingStatus);
}

function isMissingPaymentStatusColumn(error: { code?: string; message?: string }) {
  return error.code === '42703' || /payment_status/i.test(error.message ?? '');
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
    direction: booking.direction,
    arrivalTime: booking.arrivalTime,
    pickupTime: booking.pickupTime,
  };
}

async function readBooking(reference: string) {
  const result = await supabaseAdmin
    .from('bookings')
    .select(BOOKING_FIELDS)
    .eq('ref', reference)
    .maybeSingle();

  if (!result.error || !isMissingPaymentStatusColumn(result.error)) {
    return { data: result.data as BookingRow | null, error: result.error };
  }

  const fallback = await supabaseAdmin
    .from('bookings')
    .select(BOOKING_FIELDS.replace(',payment_status', ''))
    .eq('ref', reference)
    .maybeSingle();

  return {
    data: fallback.data ? ({ ...(fallback.data as unknown as BookingRow), payment_status: null }) : null,
    error: fallback.error,
  };
}

async function updateBookingStatus(reference: string, status: BookingStatus) {
  const result = await supabaseAdmin
    .from('bookings')
    .update({ status })
    .eq('ref', reference)
    .select(BOOKING_FIELDS)
    .maybeSingle();

  if (!result.error || !isMissingPaymentStatusColumn(result.error)) {
    return { data: result.data as BookingRow | null, error: result.error };
  }

  const fallback = await supabaseAdmin
    .from('bookings')
    .update({ status })
    .eq('ref', reference)
    .select(BOOKING_FIELDS.replace(',payment_status', ''))
    .maybeSingle();

  return {
    data: fallback.data ? ({ ...(fallback.data as unknown as BookingRow), payment_status: null }) : null,
    error: fallback.error,
  };
}

async function recordStatusChange(reference: string, from: string, to: BookingStatus) {
  const { error } = await supabaseAdmin.from('booking_events').insert({
    booking_ref: reference,
    event_type: 'status_changed',
    old_value: from,
    new_value: to,
    created_by: 'central-hub',
  });

  if (error) {
    console.error(`Internal Guest Services status audit insert failed for ${reference}`, error);
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const keys = Object.keys(body);
  if (keys.some((key) => !ALLOWED_BODY_KEYS.has(key))) {
    return NextResponse.json({ error: 'Only reference and status may be updated.' }, { status: 400 });
  }

  const reference = 'reference' in body && typeof body.reference === 'string' ? body.reference.trim() : '';
  const status = 'status' in body && typeof body.status === 'string' ? body.status.trim() : '';

  if (!reference) {
    return NextResponse.json({ error: 'Reference is required.' }, { status: 400 });
  }
  if (!status || !isSupportedStatus(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }

  const current = await readBooking(reference);
  if (current.error) {
    console.error(`Internal Guest Services booking read failed for ${reference}`, current.error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
  if (!current.data) {
    return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  }

  const previousStatus = current.data.status ?? 'pending';
  if (previousStatus === status) {
    return NextResponse.json({ booking: sanitizeBooking(current.data), changed: false });
  }

  const updated = await updateBookingStatus(reference, status);
  if (updated.error) {
    console.error(`Internal Guest Services booking status update failed for ${reference}`, updated.error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
  if (!updated.data) {
    return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  }

  await recordStatusChange(reference, previousStatus, status);

  return NextResponse.json({ booking: sanitizeBooking(updated.data), changed: true });
}
