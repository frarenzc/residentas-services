import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { PriceCallout } from "@/components/PriceCallout";
import type { QuoteState } from "@/components/useQuote";

// Arbitrary representative amount — not a real Guest Services price.
const QUOTE = {
  currency: "eur",
  estimatedTotal: 42,
  amountMinor: 4200,
  breakdown: [{ label: "Airport Transfer — Both ways, 2 passengers", quantity: 1, unitPrice: 42, amount: 42 }],
  quotedAt: "2026-07-21T10:00:00.000Z",
  isEstimate: true,
};

function render(state: QuoteState): string {
  return renderToStaticMarkup(createElement(PriceCallout, { state }));
}

test("nothing is shown before a selection is priceable", () => {
  expect(render({ status: "idle" })).toBe("");
});

test("the loading state is understandable and shows no amount", () => {
  const html = render({ status: "loading" });

  expect(html).toContain("Updating…");
  expect(html).toContain("Estimated price");
  expect(html).toContain('aria-busy="true"');
  // Crucially, no figure is rendered while a new quote is in flight.
  expect(html).not.toMatch(/\d/);
});

test("a successful quote renders the total, the label and the estimate wording", () => {
  const html = render({ status: "ready", quote: QUOTE });

  expect(html).toContain("42");
  expect(html).toContain(QUOTE.breakdown[0].label);
  expect(html).toContain("This is an estimate.");
  expect(html).toContain("Estimated price");
});

test("only the single returned line is rendered — no invented breakdown", () => {
  const html = render({ status: "ready", quote: QUOTE });

  expect((html.match(/price-callout-line/g) ?? []).length).toBe(1);
  for (const invented of ["Tax", "VAT", "Luggage", "Child seat", "Toll", "Fee", "Subtotal"]) {
    expect(html, invented).not.toContain(invented);
  }
});

test("the error state is friendly, actionable and leaks nothing", () => {
  const html = render({ status: "error" });

  expect(html).toContain("Estimated pricing is temporarily unavailable.");
  expect(html).toContain("You can continue completing the form.");
  expect(html).not.toMatch(/50\d|error:|failed|ECONNREFUSED|undefined/i);
});

test("the error state does not present a price", () => {
  const html = render({ status: "error" });

  expect(html).toContain("Unavailable");
  expect(html).not.toContain("42");
});
