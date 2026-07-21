import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const PAGE_SIZE = 1000;
const REPORT_FIELDS = 'ref,guest,type,hotel,submittedAt,arrival,price';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SERVICE_TYPES = new Set(['all', 'transfer', 'tuktuk']);

type ReportBookingRow = {
  ref: string | null;
  guest: string | null;
  type: string | null;
  hotel: string | null;
  submittedAt: string | null;
  arrival: string | null;
  price: number | string | null;
};

type ReportFilters = {
  submittedFrom: string | null;
  submittedTo: string | null;
  arrivalDate: string | null;
  serviceType: string;
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

function parseDateParam(request: NextRequest, name: string): string | null | NextResponse {
  const value = request.nextUrl.searchParams.get(name)?.trim() ?? '';

  if (!value) {
    return null;
  }

  if (!DATE_PATTERN.test(value)) {
    return NextResponse.json({ error: `${name} must use YYYY-MM-DD format.` }, { status: 400 });
  }

  return value;
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function parseFilters(request: NextRequest): ReportFilters | NextResponse {
  const submittedFrom = parseDateParam(request, 'submittedFrom');
  if (submittedFrom instanceof NextResponse) return submittedFrom;

  const submittedTo = parseDateParam(request, 'submittedTo');
  if (submittedTo instanceof NextResponse) return submittedTo;

  const arrivalDate = parseDateParam(request, 'arrivalDate');
  if (arrivalDate instanceof NextResponse) return arrivalDate;

  const serviceType = request.nextUrl.searchParams.get('serviceType')?.trim() || 'all';
  if (!SERVICE_TYPES.has(serviceType)) {
    return NextResponse.json({ error: 'serviceType must be all, transfer, or tuktuk.' }, { status: 400 });
  }

  return {
    submittedFrom,
    submittedTo,
    arrivalDate,
    serviceType,
  };
}

async function readReportBookings(filters: ReportFilters) {
  const rows: ReportBookingRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabaseAdmin
      .from('bookings')
      .select(REPORT_FIELDS)
      .order('submittedAt', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (filters.submittedFrom) {
      query = query.gte('submittedAt', filters.submittedFrom);
    }
    if (filters.submittedTo) {
      query = query.lt('submittedAt', nextDate(filters.submittedTo));
    }
    if (filters.serviceType !== 'all') {
      query = query.eq('type', filters.serviceType);
    }
    if (filters.arrivalDate) {
      query = query.eq('arrival', filters.arrivalDate);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    const page = (data ?? []) as ReportBookingRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }
}

function sanitizeBooking(booking: ReportBookingRow) {
  return {
    reference: booking.ref,
    guest: booking.guest,
    serviceType: booking.type,
    property: booking.hotel,
    submittedDate: booking.submittedAt,
    arrivalDate: booking.arrival,
    price: booking.price,
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorized();
  }

  const filters = parseFilters(request);
  if (filters instanceof NextResponse) {
    return filters;
  }

  const { data, error } = await readReportBookings(filters);

  if (error) {
    console.error('Internal Guest Services reports read failed', error);
    return NextResponse.json({ error: 'Read failed' }, { status: 500 });
  }

  return NextResponse.json({ bookings: (data ?? []).map(sanitizeBooking) });
}
