// Typed contract for the authoritative Guest Services quote.
//
// This app never computes a price. It asks Guest Services, which owns the only
// price table, and renders exactly what comes back — including the minor-unit
// amount, which is never derived from euros here.

export type QuoteLine = {
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type Quote = {
  currency: string;
  estimatedTotal: number;
  amountMinor: number;
  breakdown: QuoteLine[];
  quotedAt: string;
  isEstimate: boolean;
};

/** The only inputs that may ever be sent to the quote endpoint. */
export type QuoteInputs =
  | { service: "transfer"; pax: number; direction: string }
  | { service: "tuktuk"; durationMins: number };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate an unknown payload into a Quote, or return null.
 *
 * Guest Services is trusted, but a proxy, a captive portal or a deploy skew can
 * all produce a 200 with the wrong body — so nothing is rendered until the
 * shape is confirmed.
 */
export function parseQuote(payload: unknown): Quote | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;

  if (typeof raw.currency !== "string" || !raw.currency) return null;
  if (!isFiniteNumber(raw.estimatedTotal) || raw.estimatedTotal <= 0) return null;
  if (!isFiniteNumber(raw.amountMinor) || raw.amountMinor <= 0) return null;
  if (typeof raw.quotedAt !== "string" || !raw.quotedAt) return null;
  if (typeof raw.isEstimate !== "boolean") return null;
  if (!Array.isArray(raw.breakdown) || raw.breakdown.length === 0) return null;

  const breakdown: QuoteLine[] = [];
  for (const entry of raw.breakdown) {
    if (!entry || typeof entry !== "object") return null;
    const line = entry as Record<string, unknown>;
    if (typeof line.label !== "string" || !line.label) return null;
    if (!isFiniteNumber(line.quantity) || !isFiniteNumber(line.unitPrice) || !isFiniteNumber(line.amount)) {
      return null;
    }
    breakdown.push({
      label: line.label,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
    });
  }

  return {
    currency: raw.currency,
    estimatedTotal: raw.estimatedTotal,
    amountMinor: raw.amountMinor,
    breakdown,
    quotedAt: raw.quotedAt,
    isEstimate: raw.isEstimate,
  };
}

/**
 * The pricing inputs for the current form state, or null when the selection is
 * not yet priceable. Returning null is what stops a request from being made —
 * no personal, itinerary or luggage field is ever included.
 */
export function quoteInputsFor(values: {
  service: string;
  pax: number | null;
  direction: string;
  durationMins: number | null;
}): QuoteInputs | null {
  if (values.service === "transfer") {
    if (!values.pax) return null;
    return {
      service: "transfer",
      pax: values.pax,
      // Blank direction is valid; Guest Services applies the same default.
      direction: values.direction || "airport-apt",
    };
  }

  if (values.service === "tuktuk") {
    if (!values.durationMins) return null;
    return { service: "tuktuk", durationMins: values.durationMins };
  }

  return null;
}

/** Serialise pricing inputs into a query string. */
export function quoteQuery(inputs: QuoteInputs): string {
  const params = new URLSearchParams();
  params.set("service", inputs.service);

  if (inputs.service === "transfer") {
    params.set("pax", String(inputs.pax));
    params.set("direction", inputs.direction);
  } else {
    params.set("durationMins", String(inputs.durationMins));
  }

  return params.toString();
}

/** Format a quote total for display, using the currency the API returned. */
export function formatQuoteTotal(quote: Quote): string {
  try {
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: quote.currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(quote.estimatedTotal);
  } catch {
    // Unknown currency code — show the number and the raw code rather than fail.
    return `${quote.estimatedTotal} ${quote.currency.toUpperCase()}`;
  }
}
