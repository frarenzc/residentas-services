import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";

import SuccessPage from "@/app/success/page";
import CancelPage from "@/app/cancel/page";

async function renderSuccess(params: Record<string, string> = {}): Promise<string> {
  const element = await SuccessPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(element as ReactElement);
}

function renderCancel(): string {
  return renderToStaticMarkup(createElement(CancelPage));
}

// --- success ---

test("the success page confirms payment without overclaiming persistence", async () => {
  const html = await renderSuccess({ ref: "RES-ABC123" });

  expect(html).toContain("Payment received");
  expect(html).toContain("being finalised");
  // It must not assert the booking row exists — the webhook may still be running.
  expect(html).not.toMatch(/booking (has been )?(created|saved|stored|confirmed)/i);
});

test("a valid booking reference is shown", async () => {
  expect(await renderSuccess({ ref: "RES-ABC123" })).toContain("RES-ABC123");
});

test("a missing or untrusted reference is not rendered", async () => {
  for (const ref of [undefined, "", "not-a-ref", "<script>alert(1)</script>", "RES-<b>x</b>", "../../etc"]) {
    const html = await renderSuccess(ref === undefined ? {} : { ref });

    expect(html, String(ref)).not.toContain("Booking reference:");
    expect(html, String(ref)).not.toContain("<script>");
    expect(html, String(ref)).not.toContain("etc");
  }
});

test("the success page exposes no Stripe session detail", async () => {
  const html = await renderSuccess({ ref: "RES-ABC123", session_id: "cs_test_secret123" });

  expect(html).not.toContain("cs_test_secret123");
  expect(html.toLowerCase()).not.toContain("session");
  expect(html.toLowerCase()).not.toContain("stripe");
  expect(html).not.toContain("payment_intent");
});

test("the success page offers a next step and a way back", async () => {
  const html = await renderSuccess({ ref: "RES-ABC123" });

  expect(html).toMatch(/contact|reply|concierge|host/i);
  expect(html).toContain('href="/"');
});

test("the success page fetches nothing from the browser", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/success/page.tsx", import.meta.url), "utf8");

  expect(source).not.toContain("use client");
  expect(source).not.toContain("fetch(");
});

// --- cancel ---

test("the cancel page states clearly that nothing was paid", () => {
  const html = renderCancel();

  expect(html).toContain("Payment not completed");
  expect(html).toMatch(/nothing has been charged/i);
  expect(html).toMatch(/no booking was created/i);
  expect(html).not.toMatch(/\b(paid|payment received|successful)\b/i);
});

test("the cancel page returns the guest to the form without retrying automatically", async () => {
  const html = renderCancel();
  expect(html).toContain('href="/"');

  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/cancel/page.tsx", import.meta.url), "utf8");

  // No automatic session creation or redirect on this page.
  expect(source).not.toContain("fetch(");
  expect(source).not.toContain("redirect");
  expect(source).not.toContain("use client");
});

test("the cancel page exposes no raw Stripe parameters", () => {
  const html = renderCancel();

  for (const leak of ["session_id", "cs_test", "stripe", "payment_intent"]) {
    expect(html.toLowerCase(), leak).not.toContain(leak.toLowerCase());
  }
  // No query string is echoed back into the page (note "href=" legitimately
  // contains "ref=", so match the query-parameter form).
  expect(html).not.toMatch(/[?&]ref=/);
});

test("neither status page renders personal data", async () => {
  const success = await renderSuccess({
    ref: "RES-ABC123",
    email: "ana@example.com",
    firstName: "Ana",
    hotel: "Residentas Arco do Bandeira",
  } as Record<string, string>);

  for (const pii of ["ana@example.com", "Ana", "Arco"]) {
    expect(success, pii).not.toContain(pii);
  }
});
