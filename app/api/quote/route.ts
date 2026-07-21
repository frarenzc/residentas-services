import { NextResponse } from "next/server";

import {
  CURRENCY,
  computePriceEuros,
  normalizePricingInput,
  serviceLabel,
  toMinorUnits,
  type Direction,
  type ServiceType,
} from "@/lib/pricing";

export const runtime = "nodejs";

// Public, read-only price quote — now computed in this application.
//
// Migrated from Guest Services (Slice 1). Uses the same pricing authority as
// this app's checkout route, so the figure shown to a guest is the figure they
// are charged. This route:
//   • requires no authentication      • accepts no personal data
//   • reads no secrets                • touches neither Stripe nor Supabase
//   • performs no writes              • creates no booking, ref or session
//
// The response keeps the { ok, quote } envelope the browser already consumes.

const SUPPORTED_SERVICES: readonly string[] = ["transfer", "tuktuk"];
const SUPPORTED_PAX: readonly number[] = [2, 3, 4, 5];
const SUPPORTED_DIRECTIONS: readonly string[] = ["airport-apt", "apt-airport", "both"];
const SUPPORTED_DURATIONS: readonly number[] = [60, 90, 120, 180, 240, 480];

const DIRECTION_LABELS: Record<Direction, string> = {
  "airport-apt": "Airport to Apartment",
  "apt-airport": "Apartment to Airport",
  both: "Both ways",
};

const DURATION_LABELS: Record<number, string> = {
  60: "1 hour",
  90: "1.5 hours",
  120: "2 hours",
  180: "3 hours",
  240: "4 hours",
  480: "Full day (8h)",
};

type ErrorCode =
  | "invalid_service"
  | "invalid_pax"
  | "invalid_duration"
  | "invalid_direction"
  | "unpriceable"
  | "method_not_allowed";

function fail(status: number, code: ErrorCode, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

function methodNotAllowed() {
  return fail(405, "method_not_allowed", "This endpoint only supports GET.");
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const service = (params.get("service") ?? "").trim();

  if (!SUPPORTED_SERVICES.includes(service)) {
    return fail(400, "invalid_service", "Provide service=transfer or service=tuktuk.");
  }

  // Validate the raw inputs before normalising, so callers get a precise reason
  // rather than a blanket "unpriceable".
  if (service === "transfer") {
    const rawPax = (params.get("pax") ?? "").trim();
    const pax = Number(rawPax);
    if (!rawPax || !Number.isInteger(pax) || !SUPPORTED_PAX.includes(pax)) {
      return fail(400, "invalid_pax", "Provide pax as one of 2, 3, 4 or 5.");
    }

    // An omitted or blank direction is valid and defaults downstream; only a
    // present-but-unrecognised value is an error.
    const rawDirection = (params.get("direction") ?? "").trim();
    if (rawDirection && !SUPPORTED_DIRECTIONS.includes(rawDirection)) {
      return fail(
        400,
        "invalid_direction",
        "Provide direction as one of airport-apt, apt-airport or both.",
      );
    }
  } else {
    const rawDuration = (params.get("durationMins") ?? "").trim();
    const durationMins = Number(rawDuration);
    if (!rawDuration || !Number.isInteger(durationMins) || !SUPPORTED_DURATIONS.includes(durationMins)) {
      return fail(
        400,
        "invalid_duration",
        "Provide durationMins as one of 60, 90, 120, 180, 240 or 480.",
      );
    }
  }

  const normalized = normalizePricingInput({
    service: service as ServiceType,
    pax: params.get("pax") ?? undefined,
    direction: params.get("direction") ?? undefined,
    durationMins: params.get("durationMins") ?? undefined,
  });

  const estimatedTotal = computePriceEuros(normalized);
  if (estimatedTotal == null || estimatedTotal <= 0) {
    return fail(400, "unpriceable", "No price is available for this selection.");
  }

  // One line item: the price is a single flat per-vehicle figure. Tolls, taxes
  // and waiting time are already included, so inventing sub-amounts would
  // misrepresent the fare.
  const label =
    normalized.service === "transfer"
      ? `${serviceLabel(normalized)} — ${DIRECTION_LABELS[normalized.direction as Direction]}, ${Number(normalized.pax)} passengers`
      : `${serviceLabel(normalized)} — ${DURATION_LABELS[Number(normalized.durationMins)]}`;

  return NextResponse.json(
    {
      ok: true,
      quote: {
        currency: CURRENCY,
        estimatedTotal,
        amountMinor: toMinorUnits(estimatedTotal),
        breakdown: [
          {
            label,
            quantity: 1,
            unitPrice: estimatedTotal,
            amount: estimatedTotal,
          },
        ],
        quotedAt: new Date().toISOString(),
        isEstimate: true,
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      },
    },
  );
}

export async function POST() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
