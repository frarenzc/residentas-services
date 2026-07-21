import { NextResponse } from "next/server";

import { parseQuote, quoteQuery, type QuoteInputs } from "@/lib/quote";

export const runtime = "nodejs";

// Same-origin proxy to the authoritative Guest Services quote endpoint.
//
// The browser talks only to this app; GUEST_SERVICES_BASE_URL is server-only
// and never reaches the client. The upstream endpoint is public and needs no
// token, so nothing secret is involved here.
//
// This route re-derives the upstream query from validated inputs rather than
// forwarding the caller's query string, so a personal field appended by a
// caller can never be relayed to Guest Services.

const SUPPORTED_PAX = [2, 3, 4, 5];
const SUPPORTED_DIRECTIONS = ["airport-apt", "apt-airport", "both"];
const SUPPORTED_DURATIONS = [60, 90, 120, 180, 240, 480];

const UPSTREAM_TIMEOUT_MS = 5000;

function unavailable() {
  // Deliberately vague: upstream failures are an operational detail, not
  // something to surface to a guest.
  return NextResponse.json(
    { ok: false, error: "Estimated pricing is temporarily unavailable." },
    { status: 502 },
  );
}

function invalid() {
  return NextResponse.json(
    { ok: false, error: "That selection cannot be priced." },
    { status: 400 },
  );
}

/** Validate the caller's params into the narrow pricing-input shape. */
function readInputs(params: URLSearchParams): QuoteInputs | null {
  const service = (params.get("service") ?? "").trim();

  if (service === "transfer") {
    const pax = Number((params.get("pax") ?? "").trim());
    if (!SUPPORTED_PAX.includes(pax)) return null;

    const direction = (params.get("direction") ?? "").trim() || "airport-apt";
    if (!SUPPORTED_DIRECTIONS.includes(direction)) return null;

    return { service: "transfer", pax, direction };
  }

  if (service === "tuktuk") {
    const durationMins = Number((params.get("durationMins") ?? "").trim());
    if (!SUPPORTED_DURATIONS.includes(durationMins)) return null;

    return { service: "tuktuk", durationMins };
  }

  return null;
}

export async function GET(request: Request) {
  const inputs = readInputs(new URL(request.url).searchParams);
  if (!inputs) return invalid();

  const baseUrl = process.env.GUEST_SERVICES_BASE_URL;
  if (!baseUrl) {
    console.error("GUEST_SERVICES_BASE_URL is not configured; cannot fetch a quote.");
    return unavailable();
  }

  const upstream = `${baseUrl.replace(/\/+$/, "")}/api/quote?${quoteQuery(inputs)}`;

  let response: Response;
  try {
    response = await fetch(upstream, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch {
    return unavailable();
  }

  if (!response.ok) {
    // A 400 upstream means the selection genuinely has no price; anything else
    // is an outage on our side of the fence.
    return response.status === 400 ? invalid() : unavailable();
  }

  const quote = parseQuote(await response.json().catch(() => null));
  if (!quote) return unavailable();

  return NextResponse.json(
    { ok: true, quote },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } },
  );
}
