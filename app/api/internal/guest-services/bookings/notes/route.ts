import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const MAX_NOTES_LENGTH = 2000;
const ALLOWED_BODY_KEYS = new Set(['reference', 'staffNotes']);

type NotesRow = {
  ref: string;
  staff_notes: string | null;
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

function cleanNote(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readNotes(reference: string) {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('ref,staff_notes')
    .eq('ref', reference)
    .maybeSingle();

  return { data: data as NotesRow | null, error };
}

// Identity of the caller acting on behalf of a human, for the audit log.
//
// Callers authenticate with a shared service token, so the token alone only
// says "Central Hub" — it cannot say which member of staff. An optional
// `actor` in the body carries that. It is untrusted input from an already
// authenticated service, so it is length-capped and stripped of control
// characters before being stored; when absent or unusable the previous
// 'central-hub' default stands.
function auditActor(body: object): string {
  const raw = 'actor' in body && typeof body.actor === 'string' ? body.actor : '';
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return clean.length > 0 ? clean : 'central-hub';
}

async function recordNoteChange(reference: string, from: string | null, to: string | null, actor: string) {
  const { error } = await supabaseAdmin.from('booking_events').insert({
    booking_ref: reference,
    event_type: 'staff_notes_updated',
    old_value: from,
    new_value: to,
    created_by: actor,
  });

  if (error) {
    console.error(`Internal Guest Services notes audit insert failed for ${reference}`, error);
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorized();
  }

  const reference = request.nextUrl.searchParams.get('reference')?.trim() ?? '';
  if (!reference) {
    return NextResponse.json({ error: 'Reference is required.' }, { status: 400 });
  }

  const { data, error } = await readNotes(reference);
  if (error) {
    console.error(`Internal Guest Services notes read failed for ${reference}`, error);
    return NextResponse.json({ error: 'Read failed' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  }

  return NextResponse.json({ reference: data.ref, staffNotes: data.staff_notes ?? null });
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
    return NextResponse.json({ error: 'Only reference and staffNotes may be updated.' }, { status: 400 });
  }

  const reference = 'reference' in body && typeof body.reference === 'string' ? body.reference.trim() : '';
  if (!reference) {
    return NextResponse.json({ error: 'Reference is required.' }, { status: 400 });
  }

  if (!('staffNotes' in body) || typeof body.staffNotes !== 'string') {
    return NextResponse.json({ error: 'staffNotes must be a string.' }, { status: 400 });
  }

  if (body.staffNotes.length > MAX_NOTES_LENGTH) {
    return NextResponse.json({ error: `staffNotes must be ${MAX_NOTES_LENGTH} characters or fewer.` }, { status: 400 });
  }

  const current = await readNotes(reference);
  if (current.error) {
    console.error(`Internal Guest Services notes read failed for ${reference}`, current.error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
  if (!current.data) {
    return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  }

  const nextNote = cleanNote(body.staffNotes);
  if ((current.data.staff_notes ?? null) === nextNote) {
    return NextResponse.json({ reference, staffNotes: current.data.staff_notes ?? null, changed: false });
  }

  const { data, error } = await supabaseAdmin
    .from('bookings')
    .update({ staff_notes: nextNote })
    .eq('ref', reference)
    .select('ref,staff_notes')
    .maybeSingle();

  if (error) {
    console.error(`Internal Guest Services notes update failed for ${reference}`, error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  }

  const updated = data as NotesRow;
  await recordNoteChange(
    reference,
    current.data.staff_notes ?? null,
    updated.staff_notes ?? null,
    auditActor(body),
  );

  return NextResponse.json({ reference: updated.ref, staffNotes: updated.staff_notes ?? null, changed: true });
}
