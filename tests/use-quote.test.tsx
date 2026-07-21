// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";

import { useQuote } from "@/components/useQuote";
import { quoteInputsFor } from "@/lib/quote";

// Arbitrary representative amounts — never the real price table.
function quoteBody(estimatedTotal: number, label = "Airport Transfer") {
  return {
    ok: true,
    quote: {
      currency: "eur",
      estimatedTotal,
      amountMinor: estimatedTotal * 100,
      breakdown: [{ label, quantity: 1, unitPrice: estimatedTotal, amount: estimatedTotal }],
      quotedAt: "2026-07-21T10:00:00.000Z",
      isEstimate: true,
    },
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify(quoteBody(42)), { status: 200 }));
});

afterEach(() => {
  // No global auto-cleanup is configured, so unmount explicitly — otherwise
  // each test's probe stays in the document and testid lookups go ambiguous.
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders the hook and exposes its state as text. */
function Probe({ values }: { values: Parameters<typeof quoteInputsFor>[0] }) {
  const state = useQuote(quoteInputsFor(values));
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="total">{state.status === "ready" ? state.quote.estimatedTotal : ""}</span>
      <span data-testid="label">{state.status === "ready" ? state.quote.breakdown[0].label : ""}</span>
    </div>
  );
}

const TRANSFER = { service: "transfer", pax: 2, direction: "airport-apt", durationMins: null };
const TUKTUK = { service: "tuktuk", pax: null, direction: "", durationMins: 120 };

function requestedQueries(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

test("no request is made until the pricing inputs are complete", async () => {
  render(<Probe values={{ ...TRANSFER, pax: null }} />);

  expect(screen.getByTestId("status").textContent).toBe("idle");
  await new Promise((r) => setTimeout(r, 400));
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a loading state is shown, then the quote from the API", async () => {
  render(<Probe values={TRANSFER} />);

  expect(screen.getByTestId("status").textContent).toBe("loading");
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
  expect(screen.getByTestId("total").textContent).toBe("42");
});

test("a tuk-tuk selection is quoted from its duration", async () => {
  render(<Probe values={TUKTUK} />);

  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
  expect(requestedQueries().at(-1)).toContain("durationMins=120");
  expect(requestedQueries().at(-1)).toContain("service=tuktuk");
});

test("changing direction requests a new quote", async () => {
  const { rerender } = render(<Probe values={TRANSFER} />);
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));

  rerender(<Probe values={{ ...TRANSFER, direction: "both" }} />);
  await waitFor(() => expect(requestedQueries().length).toBe(2));
  expect(requestedQueries().at(-1)).toContain("direction=both");
});

test("changing passenger count requests a new quote", async () => {
  const { rerender } = render(<Probe values={TRANSFER} />);
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));

  rerender(<Probe values={{ ...TRANSFER, pax: 5 }} />);
  await waitFor(() => expect(requestedQueries().length).toBe(2));
  expect(requestedQueries().at(-1)).toContain("pax=5");
});

test("changing tour duration requests a new quote", async () => {
  const { rerender } = render(<Probe values={TUKTUK} />);
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));

  rerender(<Probe values={{ ...TUKTUK, durationMins: 480 }} />);
  await waitFor(() => expect(requestedQueries().length).toBe(2));
  expect(requestedQueries().at(-1)).toContain("durationMins=480");
});

test("switching service drops the incompatible quote and asks again", async () => {
  const { rerender } = render(<Probe values={TRANSFER} />);
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));

  fetchMock.mockResolvedValue(new Response(JSON.stringify(quoteBody(99, "Tuk-Tuk Tour")), { status: 200 }));
  rerender(<Probe values={TUKTUK} />);

  // The transfer price must not survive into the tuk-tuk selection.
  expect(screen.getByTestId("status").textContent).toBe("loading");
  expect(screen.getByTestId("total").textContent).toBe("");

  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
  expect(screen.getByTestId("total").textContent).toBe("99");
  expect(screen.getByTestId("label").textContent).toContain("Tuk-Tuk");
});

test("a slow response for an old selection cannot overwrite a newer one", async () => {
  // First selection resolves slowly; the second resolves immediately.
  let releaseSlow: (value: Response) => void = () => {};
  const slow = new Promise<Response>((resolve) => {
    releaseSlow = resolve;
  });

  fetchMock.mockImplementationOnce(() => slow);
  fetchMock.mockResolvedValue(new Response(JSON.stringify(quoteBody(77)), { status: 200 }));

  const { rerender } = render(<Probe values={TRANSFER} />);

  // Let the debounce elapse so the slow request is genuinely in flight before
  // the selection changes — otherwise it is simply cancelled and never races.
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  rerender(<Probe values={{ ...TRANSFER, pax: 5 }} />);
  await waitFor(() => expect(screen.getByTestId("total").textContent).toBe("77"));

  // The stale response lands last — and must be ignored.
  await act(async () => {
    releaseSlow(new Response(JSON.stringify(quoteBody(11)), { status: 200 }));
    await new Promise((r) => setTimeout(r, 50));
  });

  expect(screen.getByTestId("total").textContent).toBe("77");
});

test("an aborted request never surfaces as an error", async () => {
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  });

  const { rerender, unmount } = render(<Probe values={TRANSFER} />);
  rerender(<Probe values={{ ...TRANSFER, pax: 4 }} />);

  await new Promise((r) => setTimeout(r, 100));
  expect(screen.getByTestId("status").textContent).not.toBe("error");

  unmount();
});

test("a failed request shows the error state", async () => {
  fetchMock.mockResolvedValue(new Response("upstream down", { status: 502 }));
  render(<Probe values={TRANSFER} />);

  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
});

test("a malformed quote body is treated as an error, not rendered", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, quote: { estimatedTotal: "free" } }), { status: 200 }),
  );
  render(<Probe values={TRANSFER} />);

  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
  expect(screen.getByTestId("total").textContent).toBe("");
});

test("rapid changes are debounced into a single request", async () => {
  const { rerender } = render(<Probe values={TRANSFER} />);
  rerender(<Probe values={{ ...TRANSFER, pax: 3 }} />);
  rerender(<Probe values={{ ...TRANSFER, pax: 4 }} />);
  rerender(<Probe values={{ ...TRANSFER, pax: 5 }} />);

  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(requestedQueries().at(-1)).toContain("pax=5");
});
