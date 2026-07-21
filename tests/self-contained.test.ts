import { test, expect } from "vitest";

// This app is now the single, self-contained public booking application.
// These tests guard the two properties that migration was meant to achieve:
// no runtime dependency on Guest Services, and no secret reaching the browser.

async function sourceFiles(dir: string): Promise<URL[]> {
  const { readdir } = await import("node:fs/promises");
  // Trailing slash matters: without it, nested joins resolve against the parent.
  const root = new URL(`../${dir}/`, import.meta.url);

  async function walk(current: URL): Promise<URL[]> {
    const entries = await readdir(current, { withFileTypes: true });
    const found: URL[] = [];
    for (const entry of entries) {
      if ([".next", "node_modules", ".git"].includes(entry.name)) continue;
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, current);
      if (entry.isDirectory()) found.push(...(await walk(child)));
      else if (/\.(ts|tsx)$/.test(entry.name)) found.push(child);
    }
    return found;
  }

  return walk(root);
}

async function shippedSources(): Promise<URL[]> {
  return [
    ...(await sourceFiles("app")),
    ...(await sourceFiles("components")),
    ...(await sourceFiles("lib")),
  ];
}

test("no shipped source reads GUEST_SERVICES_BASE_URL", async () => {
  const { readFile } = await import("node:fs/promises");
  let scanned = 0;

  for (const file of await shippedSources()) {
    scanned += 1;
    const source = await readFile(file, "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code, `${file.pathname} still reads GUEST_SERVICES_BASE_URL`).not.toContain(
      "GUEST_SERVICES_BASE_URL",
    );
  }

  expect(scanned).toBeGreaterThan(10);
});

test("no shipped source calls a Guest Services deployment", async () => {
  const { readFile } = await import("node:fs/promises");

  for (const file of await shippedSources()) {
    const source = await readFile(file, "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code, file.pathname).not.toMatch(/guest-services|localhost:3000/i);
  }
});

test("the proxy architecture is gone", async () => {
  const { access } = await import("node:fs/promises");

  for (const removed of ["../app/api/checkout/route.ts", "../lib/checkoutPayload.ts"]) {
    await expect(
      access(new URL(removed, import.meta.url)),
      `${removed} should have been removed`,
    ).rejects.toThrow();
  }
});

test("secret-bearing modules are never imported by a client component", async () => {
  const { readFile } = await import("node:fs/promises");

  for (const file of await shippedSources()) {
    const source = await readFile(file, "utf8");
    if (!source.includes('"use client"') && !source.includes("'use client'")) continue;

    for (const serverOnly of ["@/lib/stripe", "@/lib/supabaseAdmin", "@/lib/pricing", "stripe", "@supabase/supabase-js"]) {
      expect(source, `${file.pathname} imports ${serverOnly}`).not.toContain(`from "${serverOnly}"`);
      expect(source, `${file.pathname} imports ${serverOnly}`).not.toContain(`from '${serverOnly}'`);
    }
  }
});

test("no secret env var is read outside server-only modules", async () => {
  const { readFile } = await import("node:fs/promises");
  const SECRETS = [
    "STRIPE_SECRET_KEY_RMI",
    "STRIPE_SECRET_KEY_ACTIVOS_REAIS",
    "STRIPE_WEBHOOK_SECRET_RMI",
    "STRIPE_WEBHOOK_SECRET_ACTIVOS_REAIS",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  // A secret may only be named on a server-only surface: a lib module or an
  // API route. Never in a page, a component, or anything marked "use client".
  const SERVER_ONLY = /\/(lib\/[^/]+\.ts|app\/api\/.+\/route\.ts)$/;

  for (const file of await shippedSources()) {
    const source = await readFile(file, "utf8");
    for (const secret of SECRETS) {
      if (!source.includes(secret)) continue;

      expect(file.pathname, `${secret} named outside a server-only module`).toMatch(SERVER_ONLY);
      expect(source, `${file.pathname} is a client component`).not.toContain("use client");
    }
  }
});

test("no secret is exposed under a NEXT_PUBLIC_ name", async () => {
  const { readFile } = await import("node:fs/promises");

  for (const file of await shippedSources()) {
    const source = await readFile(file, "utf8");

    expect(source, file.pathname).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE|TOKEN|STRIPE_SECRET)/);
  }
});

test("the example env file documents every variable the app reads", async () => {
  const { readFile } = await import("node:fs/promises");
  const example = await readFile(new URL("../.env.local.example", import.meta.url), "utf8");

  for (const name of [
    "NEXT_PUBLIC_SITE_URL",
    "STRIPE_SECRET_KEY_RMI",
    "STRIPE_SECRET_KEY_ACTIVOS_REAIS",
    "STRIPE_WEBHOOK_SECRET_RMI",
    "STRIPE_WEBHOOK_SECRET_ACTIVOS_REAIS",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    expect(example, name).toContain(name);
  }

  // No real value may be committed in the example: every assignment line must
  // end at the "=" (checked per line, since \s would otherwise span newlines).
  for (const line of example.split("\n")) {
    if (line.trimStart().startsWith("#") || !line.includes("=")) continue;
    expect(line.trim(), `${line} carries a value`).toMatch(/^[A-Z0-9_]+=$/);
  }
});

test("staff UI and staff auth were NOT brought across", async () => {
  const { access } = await import("node:fs/promises");

  // This app owns booking data and now serves the authenticated read/write API
  // the Hub consumes (app/api/internal/**). What must never live here is the
  // staff-facing UI or its session auth — those belong to the Hub.
  for (const excluded of ["../app/staff", "../app/book", "../app/api/staff"]) {
    await expect(
      access(new URL(excluded, import.meta.url)),
      `${excluded} must not exist in the public app`,
    ).rejects.toThrow();
  }
});

test("the internal API is present and bearer-protected, never public", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const root = new URL("../app/api/internal/guest-services/", import.meta.url);

  async function routes(dir: URL): Promise<URL[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const found: URL[] = [];
    for (const entry of entries) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) found.push(...(await routes(child)));
      else if (entry.name === "route.ts") found.push(child);
    }
    return found;
  }

  const files = await routes(root);
  expect(files.length, "expected the five internal routes").toBe(5);

  for (const file of files) {
    const source = await readFile(file, "utf8");

    // Every internal route must authenticate; none may be a client component.
    expect(source, `${file.pathname} must check a bearer token`).toMatch(/authorization/i);
    expect(source, `${file.pathname} must compare in constant time`).toContain("timingSafeEqual");
    expect(source, `${file.pathname} must not be a client component`).not.toContain("use client");
  }
});
