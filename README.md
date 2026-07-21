# Residentas Services

Public booking application for Residentas Guest Services — airport transfers and
tuk-tuk tours. Intended to be served at **https://services.residentas.com**.

> `book.residentas.com` is **not** used by this app. That domain belongs to the
> Guesty accommodation-booking experience and must not be repurposed.

## Architecture

This app is the **public interface only**. Guest Services
(`residentas-guest-services-test`) remains the source of truth:

| Concern | Owner |
| --- | --- |
| Public booking UI, service/property selection, client validation | **residentas-services** (this app) |
| Server-side re-validation of submitted form data | **residentas-services** (`/api/booking`) |
| Authoritative pricing | Guest Services |
| Stripe Checkout session creation + Stripe account routing | Guest Services |
| Booking persistence, webhooks, payment reconciliation, audit trail | Guest Services |

This application deliberately holds **no** Stripe secret, **no** Supabase
service-role key and **no** internal staff API token. The browser never calls a
bearer-protected internal endpoint.

## Checkout

Checkout is connected, server-mediated end to end:

```
browser → POST /api/checkout (this app, same origin)
        → POST /api/checkout/create-session (Guest Services, server-to-server)
        → Stripe Checkout URL
browser → Stripe → /success or /cancel (this app)
```

Guest Services remains the **sole** creator of Stripe sessions. It re-validates
the booking, recomputes the authoritative price, picks the Stripe account and
generates the booking reference. The estimate shown in the form is never sent as
authoritative pricing.

The proxy rebuilds the upstream request from an explicit allowlist of booking
fields, so return URLs, account keys, Stripe ids, quote totals and price or
currency overrides can never be injected by a caller. It stamps
`checkoutSource: "residentas-services"` itself.

**Return destinations are server-controlled.** The browser names a destination,
never a URL; Guest Services maps it to a configured origin and literal paths, so
an open redirect is structurally impossible. An unknown or unconfigured
destination falls back to the legacy `/book` pages.

## Environment variables

See `.env.local.example` — names only, never real values.

Guest Services additionally needs **`RESIDENTAS_SERVICES_URL`** (server-only) set
to this app's origin, or checkout started here will return the guest to the
legacy `/book` pages. Guest Services has no `.env.local.example`, so the name is
recorded here.

The original Guest Services `/book` route remains fully functional and is the
live booking path / rollback surface.

## Local setup

```bash
npm install
cp .env.local.example .env.local   # fill in local values
npm run dev -- --port 3002
```

Ports used locally: Guest Services `3000`, Central Hub `3001`, this app `3002`.

## Scripts

```bash
npm run dev        # local dev server
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run test       # vitest
npm run build      # production build
```

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Public booking form |
| `/success` | Post-payment landing |
| `/cancel` | Cancelled-payment landing |
| `/api/checkout` | Starts checkout via Guest Services (POST) |
| `/api/quote` | Same-origin proxy to the authoritative quote endpoint (GET) |
| `/api/booking` | Validation-only boundary from the initial migration (POST). Superseded by `/api/checkout`; retained rather than deleted because this repo is not under version control. |

## Environment variables

Names only — never commit real values. Set them in `.env.local` (local) and in
the deployment environment (production). See `.env.local.example` for the full
template.

| Name | Scope | Purpose |
| --- | --- | --- |
| `GUEST_SERVICES_BASE_URL` | Server only | Bare origin of the Guest Services app that this app calls server-side for authoritative quotes and to start checkout (e.g. `http://localhost:3000` local, `https://guest-services.residentas.com` production). Never exposed to the browser; the browser never chooses this destination. |
| `NEXT_PUBLIC_SITE_URL` | Public | Bare origin of this public booking app, used to build the checkout return (success/cancel) origin (e.g. `http://localhost:3002` local, `https://services.residentas.com` production). |
