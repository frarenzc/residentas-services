// Where Stripe Checkout returns the guest after payment.
//
// The browser never supplies a URL. The origin comes only from server-side
// configuration and the paths are literals here, so an open redirect is
// structurally impossible rather than filtered out. Host, Origin, Referer and
// forwarded-host headers are deliberately NOT consulted — all are
// attacker-controllable.
//
// Misconfiguration fails LOUDLY. An earlier version fell back to localhost,
// which in production would have sent a paying guest to a dead address with no
// signal that anything was wrong. Checkout now refuses to start instead.

const SUCCESS_PATH = "/success";
const CANCEL_PATH = "/cancel";

export class CheckoutReturnConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutReturnConfigError";
  }
}

/** True when running outside a production deployment. */
function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Validate the configured site origin.
 *
 * Production must be a bare https:// origin. A local http origin is accepted
 * only outside production, so a developer can run on localhost without
 * weakening the deployed configuration.
 */
function validateOrigin(raw: string | undefined): string {
  const value = raw?.trim();

  if (!value) {
    throw new CheckoutReturnConfigError(
      "NEXT_PUBLIC_SITE_URL is not set. Set it to this application's public origin " +
        "(for example https://services.residentas.com) before starting checkout.",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CheckoutReturnConfigError(
      `NEXT_PUBLIC_SITE_URL is not a valid URL. Expected an origin such as ` +
        `https://services.residentas.com.`,
    );
  }

  // Scheme first, so a value like "javascript:..." reports the real problem
  // rather than tripping the path check on its way past.
  const local = isLocalHostname(url.hostname);

  if (url.protocol === "http:") {
    // Plain http is a development-only convenience. Allowing it in production
    // would expose the return trip, and a non-local http host is almost always
    // a misconfigured origin.
    if (!local) {
      throw new CheckoutReturnConfigError("NEXT_PUBLIC_SITE_URL must use https.");
    }
    if (!isDevelopment()) {
      throw new CheckoutReturnConfigError(
        "NEXT_PUBLIC_SITE_URL points at localhost, which is not valid in production.",
      );
    }
  } else if (url.protocol !== "https:") {
    throw new CheckoutReturnConfigError("NEXT_PUBLIC_SITE_URL must use https.");
  }

  if (url.search || url.hash) {
    throw new CheckoutReturnConfigError(
      "NEXT_PUBLIC_SITE_URL must be a bare origin with no query string or fragment.",
    );
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    throw new CheckoutReturnConfigError(
      "NEXT_PUBLIC_SITE_URL must be a bare origin with no path.",
    );
  }

  return url.origin;
}

export type ReturnUrls = { successUrl: string; cancelUrl: string };

/**
 * Resolve the Stripe return URLs, or throw CheckoutReturnConfigError.
 *
 * `ref` is the server-generated booking reference — the only data placed in a
 * return URL. No guest name, email, phone, itinerary or price is included.
 *
 * The first argument is accepted so the checkout route stays byte-identical to
 * its Guest Services original, but it is deliberately ignored: there is exactly
 * one destination, and honouring caller input is the open-redirect risk this
 * module exists to prevent.
 */
export function resolveReturnUrls(_ignoredCallerInput: unknown, ref: string): ReturnUrls {
  const origin = validateOrigin(process.env.NEXT_PUBLIC_SITE_URL);

  return {
    successUrl: `${origin}${SUCCESS_PATH}?ref=${encodeURIComponent(ref)}`,
    cancelUrl: `${origin}${CANCEL_PATH}`,
  };
}
