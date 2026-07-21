import Stripe from 'stripe';

import type { StripeAccountKey } from '@/lib/stripe-routing';

// Phase 3D.1 — SERVER-ONLY Stripe clients, one per account (Residentas RMI and
// Activos Reais). NEVER import from a Client Component.
//
// Each account has its own secret key and its own cached client. There is no
// dynamic environment swapping: the account is chosen explicitly by the caller
// via getStripeClient(accountKey). Clients are lazily instantiated so a missing
// key doesn't crash the build/import — it throws a clear error only when that
// account's Stripe API is actually used.

const SECRET_ENV: Record<StripeAccountKey, string> = {
  rmi: 'STRIPE_SECRET_KEY_RMI',
  activos_reais: 'STRIPE_SECRET_KEY_ACTIVOS_REAIS',
};

const clients: Partial<Record<StripeAccountKey, Stripe>> = {};

export function getStripeClient(account: StripeAccountKey): Stripe {
  const cached = clients[account];
  if (cached) return cached;

  const envName = SECRET_ENV[account];
  const key = process.env[envName];
  if (!key || key.startsWith('REPLACE_WITH')) {
    throw new Error(
      `Missing ${envName}. Set it in .env.local (server-only, use the account's sk_... key) and restart the dev server.`
    );
  }

  const client = new Stripe(key);
  clients[account] = client;
  return client;
}
