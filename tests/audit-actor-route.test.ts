import { test, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Exercises the status and notes PATCH handlers end-to-end with a real request
// body, against a mocked Supabase.
//
// This exists because unit tests split either side of the boundary and missed a
// live outage: the client was proven to *send* `actor`, and auditActor() was
// proven to sanitise it, but nothing sent a body through the handler — where a
// strict ALLOWED_BODY_KEYS allow-list rejected the new key and returned 400 for
// every status update and note save.
//
// So these assert on what the route does with a whole request, and check that
// the value actually reaches booking_events.created_by.

const TOKEN = 'test-token-placeholder';

const inserts: Record<string, unknown>[] = [];

vi.mock('@/lib/supabaseAdmin', () => {
  const booking = {
    ref: 'RES-TEST1',
    status: 'pending',
    staff_notes: null,
    guest: 'A Guest',
    payment_status: 'paid',
  };

  function builder(table: string): unknown {
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: { ...booking }, error: null }),
      single: async () => ({ data: { ...booking }, error: null }),
      insert: async (row: Record<string, unknown>) => {
        if (table === 'booking_events') inserts.push(row);
        return { data: null, error: null };
      },
    };
    return chain;
  }

  const client = { from: (table: string) => builder(table) };
  return {
    supabaseAdmin: client,
    getSupabaseAdmin: () => client,
    resetSupabaseAdminForTests: () => {},
  };
});

beforeEach(() => {
  inserts.length = 0;
  process.env.GUEST_SERVICES_API_TOKEN = TOKEN;
});

function patch(url: string, body: unknown): NextRequest {
  return new NextRequest(`https://services.test${url}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function statusRoute() {
  return (await import('@/app/api/internal/guest-services/bookings/status/route')).PATCH;
}

async function notesRoute() {
  return (await import('@/app/api/internal/guest-services/bookings/notes/route')).PATCH;
}

const STATUS_URL = '/api/internal/guest-services/bookings/status';
const NOTES_URL = '/api/internal/guest-services/bookings/notes';

// --- the regression ---------------------------------------------------------

test('status update with an actor is accepted, not rejected as an unknown key', async () => {
  const handler = await statusRoute();
  const response = await handler(
    patch(STATUS_URL, { reference: 'RES-TEST1', status: 'confirmed', actor: 'staff@example.com' }),
  );

  expect(response.status).toBe(200);
});

test('note update with an actor is accepted', async () => {
  const handler = await notesRoute();
  const response = await handler(
    patch(NOTES_URL, { reference: 'RES-TEST1', staffNotes: 'a note', actor: 'staff@example.com' }),
  );

  expect(response.status).toBe(200);
});

test('the actor reaches booking_events.created_by', async () => {
  const handler = await statusRoute();
  await handler(patch(STATUS_URL, { reference: 'RES-TEST1', status: 'confirmed', actor: 'staff@example.com' }));

  const audit = inserts.find((row) => row.event_type === 'status_changed');
  expect(audit?.created_by).toBe('staff@example.com');
});

test('a body without an actor still works and falls back to central-hub', async () => {
  // An older Central Hub sends no actor; it must not start failing.
  const handler = await statusRoute();
  const response = await handler(patch(STATUS_URL, { reference: 'RES-TEST1', status: 'confirmed' }));

  expect(response.status).toBe(200);
  expect(inserts.find((row) => row.event_type === 'status_changed')?.created_by).toBe('central-hub');
});

test('a control-character actor is sanitised before it is stored', async () => {
  const handler = await statusRoute();
  await handler(
    patch(STATUS_URL, { reference: 'RES-TEST1', status: 'confirmed', actor: 'staff@example.com\nfake' }),
  );

  expect(inserts.find((row) => row.event_type === 'status_changed')?.created_by).toBe('staff@example.comfake');
});

// --- the allow-list still rejects everything else ---------------------------

test('genuinely unknown keys are still rejected', async () => {
  // Widening the allow-list must not have opened it up.
  const handler = await statusRoute();
  const response = await handler(
    patch(STATUS_URL, { reference: 'RES-TEST1', status: 'confirmed', price: 0 }),
  );

  expect(response.status).toBe(400);
});

test('a booking column cannot be smuggled through the notes route', async () => {
  const handler = await notesRoute();
  const response = await handler(
    patch(NOTES_URL, { reference: 'RES-TEST1', staffNotes: 'x', payment_status: 'paid' }),
  );

  expect(response.status).toBe(400);
});

test('an actor cannot be used without a valid bearer token', async () => {
  const handler = await statusRoute();
  const request = new NextRequest(`https://services.test${STATUS_URL}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference: 'RES-TEST1', status: 'confirmed', actor: 'attacker@example.com' }),
  });

  expect((await handler(request)).status).toBe(401);
  expect(inserts).toHaveLength(0);
});
