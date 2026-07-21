import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

// Phase 5.3 — read-only audit history for the Central Hub.
//
// Returns the existing booking_events records for one booking. Read-only: this
// route never writes audit data and adds no new event types. booking_events has
// RLS enabled with no policies and privileges revoked from anon/authenticated,
// so this service-role route is the only read path the Hub can use — the Hub
// never queries the database directly and the browser never sees the token.

const MAX_EVENTS = 50;
const REF_PATTERN = /^RES-[A-Z0-9]{1,12}$/;

type EventRow = {
  booking_ref: string;
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  created_by: string | null;
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

// Hub-facing shape: camelCase, no internal id (the Hub does not need it).
function sanitizeEvent(event: EventRow) {
  return {
    bookingRef: event.booking_ref,
    eventType: event.event_type,
    oldValue: event.old_value,
    newValue: event.new_value,
    createdAt: event.created_at,
    createdBy: event.created_by,
  };
}

// GET /api/internal/guest-services/bookings/events?reference=RES-XXXXXX
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorized();
  }

  const reference = request.nextUrl.searchParams.get('reference')?.trim() ?? '';
  if (!reference) {
    return NextResponse.json({ error: 'Reference is required.' }, { status: 400 });
  }
  if (!REF_PATTERN.test(reference)) {
    return NextResponse.json({ error: 'Invalid reference.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('booking_events')
    .select('booking_ref,event_type,old_value,new_value,created_at,created_by')
    .eq('booking_ref', reference)
    .order('created_at', { ascending: false })
    .limit(MAX_EVENTS);

  if (error) {
    console.error(`Internal Guest Services audit read failed for ${reference}`, error);
    return NextResponse.json({ error: 'Read failed' }, { status: 500 });
  }

  // Unknown booking simply has no events -> empty list (the Hub shows an empty
  // state). We deliberately do not join the bookings table to distinguish them.
  return NextResponse.json({ reference, events: (data as EventRow[] | null ?? []).map(sanitizeEvent) });
}
