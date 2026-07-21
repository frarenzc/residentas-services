import { NextRequest } from 'next/server';

import { handleStripeWebhook } from '@/lib/stripe-webhook';

export const runtime = 'nodejs';

// Phase 3D.1 — Residentas RMI Stripe account webhook.
// Verified with STRIPE_WEBHOOK_SECRET_RMI; only receives events for the RMI
// account (Arco do Bandeira payments).
export async function POST(request: NextRequest) {
  return handleStripeWebhook(request, 'rmi');
}
