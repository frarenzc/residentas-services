"use client";

import { formatQuoteTotal } from "@/lib/quote";
import type { QuoteState } from "./useQuote";

// Estimated-price callout. Every figure shown here comes from the Guest
// Services quote response; nothing is calculated or derived in the browser.

export function PriceCallout({ state }: { state: QuoteState }) {
  if (state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <div className="price-callout" data-testid="price-callout" aria-busy="true">
        <div>
          <div className="price-callout-label">Estimated price</div>
          {/* The previous amount is deliberately not shown: it belonged to a
              different selection. */}
          <div className="price-callout-value price-callout-pending">Updating…</div>
        </div>
        <span className="price-callout-note" role="status">
          Fetching the latest price for your selection.
        </span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="price-callout price-callout-error" data-testid="price-callout" role="status">
        <div>
          <div className="price-callout-label">Estimated price</div>
          <div className="price-callout-value price-callout-pending">Unavailable</div>
        </div>
        <span className="price-callout-note">
          Estimated pricing is temporarily unavailable. You can continue completing the form.
        </span>
      </div>
    );
  }

  const { quote } = state;
  const line = quote.breakdown[0];

  return (
    <div className="price-callout" data-testid="price-callout">
      <div>
        <div className="price-callout-label">Estimated price</div>
        <div className="price-callout-value" data-testid="price-total">
          {formatQuoteTotal(quote)}
        </div>
        <div className="price-callout-line" data-testid="price-line">
          {line.label}
        </div>
      </div>
      <span className="price-callout-note">
        This is an estimate. Final confirmation is subject to availability.
      </span>
    </div>
  );
}
