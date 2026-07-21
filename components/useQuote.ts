"use client";

import { useEffect, useState } from "react";

import { parseQuote, quoteQuery, type Quote, type QuoteInputs } from "@/lib/quote";

export type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; quote: Quote }
  | { status: "error" };

const DEBOUNCE_MS = 250;

/** A settled result, tagged with the request it answers. */
type Result = { key: string; quote: Quote | null };

/**
 * Fetch an estimated price for the current pricing selection.
 *
 * `inputs` is null whenever the selection is not yet priceable, which is what
 * prevents a request from being made too early. Requests are debounced and
 * aborted when the selection changes.
 *
 * Stale protection is structural rather than defensive: a result carries the
 * key it answers, and only a result matching the CURRENT key is ever rendered.
 * A late response for an old selection therefore cannot be displayed, and
 * idle/loading are derived during render instead of being set from the effect.
 */
export function useQuote(inputs: QuoteInputs | null): QuoteState {
  const [result, setResult] = useState<Result | null>(null);

  // Serialising the inputs gives a stable dependency and the request identity.
  const key = inputs ? quoteQuery(inputs) : null;

  useEffect(() => {
    if (!key) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/quote?${key}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });

        // Superseded while in flight: drop the answer entirely rather than
        // storing it, which would otherwise knock a valid newer result back
        // into the loading state.
        if (controller.signal.aborted) return;

        if (!response.ok) {
          setResult({ key, quote: null });
          return;
        }

        const data = (await response.json().catch(() => null)) as { quote?: unknown } | null;
        if (controller.signal.aborted) return;

        setResult({ key, quote: parseQuote(data?.quote) });
      } catch {
        // An abort is our own doing, not a failure worth showing anyone.
        if (controller.signal.aborted) return;
        setResult({ key, quote: null });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  if (!key) return { status: "idle" };
  if (result?.key !== key) return { status: "loading" };

  return result.quote ? { status: "ready", quote: result.quote } : { status: "error" };
}
