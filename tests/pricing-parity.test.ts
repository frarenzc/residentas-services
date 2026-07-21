import { test, expect } from "vitest";

import { computePriceEuros, toMinorUnits, CURRENCY, normalizePricingInput } from "@/lib/pricing";

// Pricing now lives in this app, but Guest Services keeps its own copy for the
// legacy /book checkout. These tests pin our tables and — when the Guest
// Services checkout is reachable on disk — prove the two copies still agree.
//
// A price change must be applied to BOTH repositories.

const GUEST_SERVICES_PRICING =
  "/Users/molzcanlas/Desktop/residentas-guest-services-test/lib/pricing.ts";

const DIRECTIONS = ["airport-apt", "apt-airport", "both"] as const;
const PAX = [2, 3, 4, 5] as const;
const DURATIONS = [60, 90, 120, 180, 240, 480] as const;

// --- golden values: a price edit must be a deliberate, reviewed change ---

test("golden transfer prices", () => {
  const expected: Record<string, number> = {
    "2|airport-apt": 35, "2|apt-airport": 25, "2|both": 55,
    "3|airport-apt": 45, "3|apt-airport": 35, "3|both": 75,
    "4|airport-apt": 45, "4|apt-airport": 35, "4|both": 75,
    "5|airport-apt": 55, "5|apt-airport": 55, "5|both": 100,
  };

  for (const [key, price] of Object.entries(expected)) {
    const [pax, direction] = key.split("|");
    expect(computePriceEuros({ service: "transfer", pax: Number(pax), direction }), key).toBe(price);
  }
});

test("golden tuk-tuk prices", () => {
  const expected: Record<number, number> = { 60: 100, 90: 140, 120: 190, 180: 280, 240: 320, 480: 480 };

  for (const [mins, price] of Object.entries(expected)) {
    expect(computePriceEuros({ service: "tuktuk", durationMins: Number(mins) }), mins).toBe(price);
  }
});

test("currency and minor-unit conversion match the charged amount", () => {
  expect(CURRENCY).toBe("eur");
  expect(toMinorUnits(35)).toBe(3500);
  expect(toMinorUnits(0)).toBe(0);
});

test("unpriceable selections return null rather than a fallback price", () => {
  expect(computePriceEuros({ service: "transfer", pax: 1, direction: "both" })).toBeNull();
  expect(computePriceEuros({ service: "transfer", pax: 6, direction: "both" })).toBeNull();
  expect(computePriceEuros({ service: "transfer", pax: 2, direction: "sideways" })).toBeNull();
  expect(computePriceEuros({ service: "tuktuk", durationMins: 45 })).toBeNull();
});

test("blank and whitespace directions normalise to the default", () => {
  for (const direction of ["", "   ", undefined]) {
    expect(normalizePricingInput({ service: "transfer", pax: 2, direction }).direction).toBe("airport-apt");
  }
});

test("tuk-tuk normalisation drops transfer-only inputs", () => {
  const normalized = normalizePricingInput({ service: "tuktuk", durationMins: 120, pax: 4, direction: "both" });

  expect(normalized).toEqual({ service: "tuktuk", durationMins: 120 });
});

// --- cross-repository drift detection ---

/**
 * Evaluate the Guest Services price tables by parsing its source, rather than
 * importing across repositories. Returns null when the file is not present so
 * this suite still passes on a machine that only has this app checked out.
 */
async function guestServicesTables(): Promise<{
  transfer: Record<number, number[]>;
  tuktuk: Record<number, number>;
} | null> {
  const { readFile } = await import("node:fs/promises");

  let source: string;
  try {
    source = await readFile(GUEST_SERVICES_PRICING, "utf8");
  } catch {
    return null;
  }

  const transferBlock = source.match(/TRANSFER_PRICES[^=]*=\s*\{([\s\S]*?)\};/)?.[1];
  const tuktukBlock = source.match(/TUKTUK_PRICES[^=]*=\s*\{([\s\S]*?)\};/)?.[1];
  if (!transferBlock || !tuktukBlock) return null;

  const transfer: Record<number, number[]> = {};
  for (const [, pax, values] of transferBlock.matchAll(/(\d+):\s*\[([^\]]+)\]/g)) {
    transfer[Number(pax)] = values.split(",").map((v) => Number(v.trim()));
  }

  const tuktuk: Record<number, number> = {};
  for (const [, mins, price] of tuktukBlock.matchAll(/(\d+):\s*(\d+)/g)) {
    tuktuk[Number(mins)] = Number(price);
  }

  return { transfer, tuktuk };
}

test("transfer prices match the Guest Services copy", async () => {
  const tables = await guestServicesTables();
  if (!tables) {
    // Guest Services not available on this machine — nothing to compare.
    return;
  }

  expect(Object.keys(tables.transfer).map(Number).sort()).toEqual([...PAX]);

  for (const pax of PAX) {
    DIRECTIONS.forEach((direction, index) => {
      expect(
        computePriceEuros({ service: "transfer", pax, direction }),
        `transfer ${pax} ${direction} differs from Guest Services`,
      ).toBe(tables.transfer[pax][index]);
    });
  }
});

test("tuk-tuk prices match the Guest Services copy", async () => {
  const tables = await guestServicesTables();
  if (!tables) return;

  expect(Object.keys(tables.tuktuk).map(Number).sort((a, b) => a - b)).toEqual([...DURATIONS]);

  for (const durationMins of DURATIONS) {
    expect(
      computePriceEuros({ service: "tuktuk", durationMins }),
      `tuk-tuk ${durationMins} differs from Guest Services`,
    ).toBe(tables.tuktuk[durationMins]);
  }
});
