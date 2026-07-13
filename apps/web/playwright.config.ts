/**
 * Playwright configuration for the SuperHeroCPR web app.
 *
 * Three test projects:
 *  - guest    : public pages, no login required
 *  - customer : customer-authenticated flows (booking, dashboard)
 *  - admin    : admin-authenticated flows (sessions, invoices)
 *
 * Auth setup files log in once and save browser state so individual spec
 * files never re-authenticate. Saved state lives in tests/.auth/ (gitignored).
 *
 * Set PLAYWRIGHT_BASE_URL to override the default dev-server port.
 * Example: PLAYWRIGHT_BASE_URL=http://localhost:3001 npm test
 */

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 8_000 },

  // Setup projects must run before their dependents, so disable full parallel.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["list"],
  ],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },

  projects: [
    // ── Auth setup projects (run first, save browser state) ─────────────────
    {
      name: "setup-customer",
      testMatch: /auth\/customer\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "setup-admin",
      testMatch: /auth\/admin\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    // ── Guest tests: no login required ──────────────────────────────────────
    {
      name: "guest",
      testMatch:
        /e2e\/(public-pages|auth|contact-form|rollcall|submit-roster|merch)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    // ── Customer tests: uses saved customer session ──────────────────────────
    {
      name: "customer",
      testMatch: /e2e\/(booking-flow|customer-dashboard)\.spec\.ts/,
      dependencies: ["setup-customer"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/.auth/customer.json",
      },
    },

    // ── Admin tests: uses saved admin session ────────────────────────────────
    {
      name: "admin",
      testMatch: /e2e\/admin\.spec\.ts/,
      dependencies: ["setup-admin"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/.auth/admin.json",
      },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    // Reuse an already-running server in local dev to avoid double-start; always
    // start fresh in CI. Playwright 1.60 types this as `true | undefined`, so we
    // omit it (undefined) in CI rather than passing `false`.
    reuseExistingServer: process.env.CI ? undefined : true,
    timeout: 120_000,
  },
});
