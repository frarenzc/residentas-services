// Where Stripe Checkout returns the guest after payment.
//
// Migrated from Guest Services and localised: this application is now the
// public booking app, so checkout always returns to ITS OWN /success and
// /cancel routes. Guest Services keeps its own copy for the legacy /book flow.
//
// The security property is unchanged and is the point of this module: the
// browser never supplies a URL. The origin comes only from server-side
// configuration and the paths are literals here, so an open redirect is
// structurally impossible rather than filtered out. Host, Origin, Referer and
// forwarded-host headers are deliberately NOT consulted — all are
// attacker-controllable.

const SUCCESS_PATH = "/success";
const CANCEL_PATH = "/cancel";
const LOCAL_FALLBACK_ORIGIN = "http://localhost:3002";

/**
 * Accept an origin only if it is a bare https:// origin (or a local http one
 * for development). A configured value carrying a path, query or fragment is
 * rejected, since that is how a misconfigured env turns into a redirect bug.
 */
function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) return null;
  if (url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;

  return url.origin;
}

export type ReturnUrls = { successUrl: string; cancelUrl: string };

/**
 * Resolve the Stripe return URLs.
 *
 * `ref` is the server-generated booking reference — the only data placed in a
 * return URL. No guest name, email, phone, itinerary or price is included.
 *
 * The `rawSource` argument is accepted so the migrated checkout route stays
 * byte-identical to its Guest Services original, but it is deliberately
 * ignored: there is exactly one destination now, and honouring caller input
 * here is precisely the open-redirect risk this module exists to prevent.
 */
export function resolveReturnUrls(_rawSource: unknown, ref: string): ReturnUrls {
  const origin = safeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ?? LOCAL_FALLBACK_ORIGIN;

  return {
    successUrl: `${origin}${SUCCESS_PATH}?ref=${encodeURIComponent(ref)}`,
    cancelUrl: `${origin}${CANCEL_PATH}`,
  };
}
