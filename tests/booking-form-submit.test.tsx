// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

import BookingForm from "@/components/BookingForm";
import { PROPERTIES } from "@/lib/catalog";

const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_placeholder";

const fetchMock = vi.fn();
const assign = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // Intercept navigation so no redirect actually happens in the test run.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign },
  });

  // Quotes succeed by default; checkout is set per-test.
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith("/api/quote")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            quote: {
              currency: "eur",
              estimatedTotal: 42,
              amountMinor: 4200,
              breakdown: [{ label: "Airport Transfer", quantity: 1, unitPrice: 42, amount: 42 }],
              quotedAt: "2026-07-21T10:00:00.000Z",
              isEstimate: true,
            },
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, url: STRIPE_URL, ref: "RES-ABC123" }), { status: 200 }));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Fill the minimum valid transfer booking. */
function fillValidBooking() {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Lopes" } });
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "ana@example.com" } });
  fireEvent.change(screen.getByLabelText("Apartment"), { target: { value: PROPERTIES[0] } });
  fireEvent.change(screen.getByLabelText("Number of passengers"), { target: { value: "2" } });
}

function checkoutCalls() {
  return fetchMock.mock.calls.filter((call) => String(call[0]) === "/api/checkout");
}

test("the button offers payment only now that checkout is connected", () => {
  render(<BookingForm />);
  expect(screen.getByTestId("submit").textContent).toBe("Continue to payment");
});

test("validation still blocks an incomplete submission", async () => {
  render(<BookingForm />);
  fireEvent.click(screen.getByTestId("submit"));

  await waitFor(() => expect(screen.getByTestId("form-error")).toBeTruthy());
  expect(checkoutCalls()).toHaveLength(0);
  expect(assign).not.toHaveBeenCalled();
});

test("a valid submission redirects to the returned Stripe URL", async () => {
  render(<BookingForm />);
  fillValidBooking();
  fireEvent.click(screen.getByTestId("submit"));

  await waitFor(() => expect(assign).toHaveBeenCalledWith(STRIPE_URL));
  expect(checkoutCalls()).toHaveLength(1);
});

test("the submit button shows a loading state and is disabled while processing", async () => {
  let release: (value: Response) => void = () => {};
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith("/api/quote")) return new Promise(() => {});
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });

  render(<BookingForm />);
  fillValidBooking();
  fireEvent.click(screen.getByTestId("submit"));

  await waitFor(() => expect(screen.getByTestId("submit").textContent).toBe("Starting secure checkout…"));
  expect((screen.getByTestId("submit") as HTMLButtonElement).disabled).toBe(true);

  release(new Response(JSON.stringify({ ok: true, url: STRIPE_URL, ref: "R" }), { status: 200 }));
  await waitFor(() => expect(assign).toHaveBeenCalled());
});

test("rapid synchronous clicks cannot start more than one checkout session", async () => {
  // Regression: a React-state guard passed this via fireEvent (which flushes
  // between clicks) but let THREE sessions through in a real browser, where
  // clicks in one task all observe the pre-render state. Dispatching raw events
  // without an act() flush reproduces the browser behaviour.
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith("/api/quote")) return new Promise(() => {});
    return new Promise(() => {}); // checkout never settles
  });

  render(<BookingForm />);
  fillValidBooking();

  const submit = screen.getByTestId("submit");
  submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await waitFor(() => expect(checkoutCalls().length).toBeGreaterThan(0));
  expect(checkoutCalls()).toHaveLength(1);
});

test("double submission cannot start two checkout sessions", async () => {
  let release: (value: Response) => void = () => {};
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith("/api/quote")) return new Promise(() => {});
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });

  render(<BookingForm />);
  fillValidBooking();

  const submit = screen.getByTestId("submit");
  fireEvent.click(submit);
  fireEvent.click(submit);
  fireEvent.click(submit);

  await waitFor(() => expect(screen.getByTestId("submit").textContent).toBe("Starting secure checkout…"));
  expect(checkoutCalls()).toHaveLength(1);

  release(new Response(JSON.stringify({ ok: true, url: STRIPE_URL, ref: "R" }), { status: 200 }));
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
});

test("a checkout failure shows a friendly error and preserves form data", async () => {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith("/api/quote")) return new Promise(() => {});
    return Promise.resolve(
      new Response(JSON.stringify({ ok: false, error: "Checkout is temporarily unavailable. Please try again in a moment." }), {
        status: 502,
      }),
    );
  });

  render(<BookingForm />);
  fillValidBooking();
  fireEvent.click(screen.getByTestId("submit"));

  await waitFor(() => expect(screen.getByTestId("form-error").textContent).toContain("temporarily unavailable"));

  // No redirect, and every entered value survives.
  expect(assign).not.toHaveBeenCalled();
  expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Ana");
  expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe("Lopes");
  expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("ana@example.com");
  expect((screen.getByLabelText("Apartment") as HTMLSelectElement).value).toBe(PROPERTIES[0]);

  // The button returns to an actionable state.
  expect((screen.getByTestId("submit") as HTMLButtonElement).disabled).toBe(false);
});

test("the error is announced to assistive technology", async () => {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith("/api/quote")) return new Promise(() => {});
    return Promise.resolve(new Response(JSON.stringify({ ok: false, error: "Nope." }), { status: 502 }));
  });

  render(<BookingForm />);
  fillValidBooking();
  fireEvent.click(screen.getByTestId("submit"));

  await waitFor(() => expect(screen.getByTestId("form-error").getAttribute("role")).toBe("alert"));
});

test("a malformed checkout response never triggers a redirect", async () => {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith("/api/quote")) return new Promise(() => {});
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })); // no url
  });

  render(<BookingForm />);
  fillValidBooking();
  fireEvent.click(screen.getByTestId("submit"));

  await waitFor(() => expect(screen.getByTestId("form-error")).toBeTruthy());
  expect(assign).not.toHaveBeenCalled();
});

test("a network failure is handled without losing the form", async () => {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith("/api/quote")) return new Promise(() => {});
    return Promise.reject(new Error("offline"));
  });

  render(<BookingForm />);
  fillValidBooking();
  fireEvent.click(screen.getByTestId("submit"));

  await waitFor(() => expect(screen.getByTestId("form-error").textContent).toContain("Network error"));
  expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Ana");
  expect(assign).not.toHaveBeenCalled();
});

// --- the quote is advisory only ---

test("checkout still proceeds when the quote is unavailable", async () => {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith("/api/quote")) {
      return Promise.resolve(new Response("down", { status: 502 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, url: STRIPE_URL, ref: "R" }), { status: 200 }));
  });

  render(<BookingForm />);
  fillValidBooking();

  // The estimate failed…
  await waitFor(() => expect(screen.getByTestId("price-callout").textContent).toContain("temporarily unavailable"));

  // …but payment is still reachable, because Guest Services prices authoritatively.
  fireEvent.click(screen.getByTestId("submit"));
  await waitFor(() => expect(assign).toHaveBeenCalledWith(STRIPE_URL));
});

test("no estimate or price is sent to the checkout endpoint", async () => {
  render(<BookingForm />);
  fillValidBooking();
  fireEvent.click(screen.getByTestId("submit"));

  await waitFor(() => expect(assign).toHaveBeenCalled());

  const body = JSON.parse(String((checkoutCalls().at(-1)![1] as RequestInit).body));
  for (const forbidden of ["price", "amount", "amountMinor", "estimatedTotal", "quote", "currency"]) {
    expect(body, forbidden).not.toHaveProperty(forbidden);
  }
});

test("no personal data is written to the console during submission", async () => {
  const spies = (["log", "error", "warn", "info"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );

  render(<BookingForm />);
  fillValidBooking();
  fireEvent.click(screen.getByTestId("submit"));
  await waitFor(() => expect(assign).toHaveBeenCalled());

  const logged = spies.flatMap((spy) => spy.mock.calls.flat()).map(String).join(" ");
  for (const pii of ["Ana", "Lopes", "ana@example.com", PROPERTIES[0]]) {
    expect(logged, pii).not.toContain(pii);
  }
  spies.forEach((spy) => spy.mockRestore());
});
