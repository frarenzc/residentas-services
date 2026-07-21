import { NextRequest } from 'next/server';

import { handleStripeWebhook } from '@/lib/stripe-webhook';

export const runtime = 'nodejs';

// Phase 3D.1 — Activos Reais Stripe account webhook.
// Verified with STRIPE_WEBHOOK_SECRET_ACTIVOS_REAIS; receives events for every
// property except Arco do Bandeira.
export async function POST(request: NextRequest) {
  return handleStripeWebhook(request, 'activos_reais');
}
