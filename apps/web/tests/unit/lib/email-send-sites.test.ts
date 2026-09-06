/**
 * Inventory guard for every email the system is supposed to send.
 *
 * WHY THIS FILE EXISTS
 *   On 2026-07-15 a refactor split `POST /api/rollcall/register` into two new
 *   routes. The route's welcome-email send was not carried over to either one.
 *   Nothing failed: no test broke, no type error, no log line. The template sat
 *   in lib/emails.ts as dead code for seven weeks and students silently stopped
 *   receiving it. It was found by reading git history, not by any signal.
 *
 *   That is the failure mode this file exists to make impossible. Every send in
 *   the app passes a unique `context` string to sendEmail(). This test asserts
 *   the full set of those strings — so deleting or moving a send fails the
 *   suite, and adding one fails until it is registered here with a note about
 *   what it sends and when.
 *
 * This is a static guard: it proves a send SITE exists, not that it fires under
 * the right conditions. Runtime proof of the latter lives in the per-route
 * tests under tests/unit/api/. Both are needed — this one catches deletion,
 * those catch broken logic.
 */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every email send site in the app, keyed by its `context` string, valued by
 * the file that must contain it. Keep the note in the comment above each group
 * accurate — this doubles as the catalogue of what the system emails and why.
 */
const EXPECTED_SEND_SITES: Record<string, string> = {
  // ── Account lifecycle ──────────────────────────────────────────────────────
  "auth/register:welcome": "app/api/auth/register/route.ts",
  "emails/welcome": "app/api/emails/welcome/route.ts",
  "auth/reset-password": "app/api/auth/reset-password/route.ts",
  "account/archive": "app/api/account/archive/route.ts",
  "customers/create:setup": "app/api/customers/create/route.ts",
  "customers/send-password-reset": "app/api/customers/[id]/send-password-reset/route.ts",

  // ── Staff ──────────────────────────────────────────────────────────────────
  "staff/invite": "app/api/staff/invite/route.ts",
  "staff/resend-invite": "app/api/staff/[id]/resend-invite/route.ts",

  // ── Public contact form ────────────────────────────────────────────────────
  "contact:business": "app/api/contact/route.ts",
  "contact:auto-reply": "app/api/contact/route.ts",

  // ── Bookings: paid, free, admin-added, and the instructor's copy ───────────
  "bookings/confirm:customer": "app/api/bookings/confirm/route.ts",
  "bookings/confirm:instructor": "app/api/bookings/confirm/route.ts",
  "bookings/confirm-free:customer": "app/api/bookings/confirm-free/route.ts",
  "bookings/confirm-free:instructor": "app/api/bookings/confirm-free/route.ts",
  "customers/add-booking:customer": "app/api/customers/[id]/add-booking/route.ts",
  "customers/add-booking:instructor": "app/api/customers/[id]/add-booking/route.ts",
  "charge-and-book:customer": "app/api/sessions/[id]/charge-and-book/route.ts",
  "charge-and-book:instructor": "app/api/sessions/[id]/charge-and-book/route.ts",
  "dev/book-free": "app/api/dev/book-free/route.ts",
  "admin/sessions:booking-cancelled": "app/(admin)/admin/sessions/[id]/actions.ts",

  // ── Rollcall ───────────────────────────────────────────────────────────────
  "rollcall/checkin-by-profile:welcome": "app/api/rollcall/checkin-by-profile/route.ts",

  // ── Class requests (customer-initiated bookings) ──────────────────────────
  "class-requests:customer-confirm": "app/api/class-requests/route.ts",
  "class-requests:admin-notify": "app/api/class-requests/route.ts",
  "class-requests/approve:customer": "app/api/class-requests/[id]/approve/route.ts",
  "class-requests/approve:instructor-opportunity":
    "app/api/class-requests/[id]/approve/route.ts",
  "class-requests/reject:customer": "app/api/class-requests/[id]/reject/route.ts",

  // ── Session lifecycle: cancel, claim, accept ──────────────────────────────
  "sessions/cancel:admin": "app/api/sessions/[id]/cancel/route.ts",
  "sessions/cancel:instructor-opportunity": "app/api/sessions/[id]/cancel/route.ts",
  "sessions/claim:student": "app/api/sessions/[id]/claim/route.ts",
  "sessions/claim:admin": "app/api/sessions/[id]/claim/route.ts",
  "accept-teach:customer": "app/api/sessions/[id]/accept-teach/route.ts",
  "accept-teach:admin": "app/api/sessions/[id]/accept-teach/route.ts",
  "notify-unclaimed-opportunities:digest":
    "app/api/sessions/notify-unclaimed-opportunities/route.ts",
  "assistant-reminder": "lib/assistant-reminder.ts",

  // ── Invoices ───────────────────────────────────────────────────────────────
  "invoice-actions:invoice": "lib/invoice-actions.ts",
  "invoice-actions:instructor-paid": "lib/invoice-actions.ts",
  "invoice-actions:customer-paid": "lib/invoice-actions.ts",
  "invoices/resend": "app/api/invoices/resend/route.ts",

  // ── Merch orders ───────────────────────────────────────────────────────────
  "orders/confirm:customer": "app/api/orders/confirm/route.ts",
  "orders/confirm:business": "app/api/orders/confirm/route.ts",
  "orders/mark-shipped": "app/api/orders/mark-shipped/route.ts",

  // ── Roster upload ──────────────────────────────────────────────────────────
  "roster-upload/submit:submitter": "app/api/roster-upload/submit/route.ts",
  "roster-upload/submit:manager": "app/api/roster-upload/submit/route.ts",

  // ── Team bookings ──────────────────────────────────────────────────────────
  "team-bookings:share-link": "lib/team-bookings.ts",
  "team-bookings:invoice-missing": "lib/team-bookings.ts",
  "team-signup:customer": "app/api/team-bookings/[share_token]/signup/route.ts",
  "team-signup:instructor": "app/api/team-bookings/[share_token]/signup/route.ts",

  // ── Payouts ────────────────────────────────────────────────────────────────
  "payout-notify:denial": "lib/payout-notify.ts",
  "payout-notify:stuck-digest": "lib/payout-notify.ts",
  "payout-notify:instructor-paid": "lib/payout-notify.ts",

  // ── Scheduled / operational ────────────────────────────────────────────────
  "certifications/send-reminders": "app/api/certifications/send-reminders/route.ts",
  "admin/daily-summary": "app/api/admin/daily-summary/route.ts",
  "credential-notify:alert": "lib/credential-notify.ts",
};

/** Directories scanned for send sites. */
const SCAN_ROOTS = ["app", "lib"];

/**
 * Recursively collects .ts/.tsx files under a directory.
 * @param dir - Directory to walk, relative to the project root.
 * @returns Absolute-ish paths relative to the project root.
 */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** Matches the `context: "..."` argument passed to sendEmail/sendEmails. */
const CONTEXT_PATTERN = /context:\s*"([^"]+)"/g;

/**
 * Scans the source tree for every email send context actually present.
 * @returns Map of context string to the file(s) it was found in.
 */
function findActualSendSites(): Map<string, string[]> {
  const found = new Map<string, string[]>();

  for (const root of SCAN_ROOTS) {
    for (const file of collectSourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      // Only files that actually route through the shared sender count — this
      // keeps an unrelated `context:` property elsewhere from being picked up.
      if (!source.includes("@/lib/send-email")) continue;

      for (const match of source.matchAll(CONTEXT_PATTERN)) {
        const context = match[1];
        found.set(context, [...(found.get(context) ?? []), file]);
      }
    }
  }

  return found;
}

describe("email send-site inventory", () => {
  const actual = findActualSendSites();

  test("no registered email send has been deleted or moved", () => {
    const missing: string[] = [];
    const moved: string[] = [];

    for (const [context, expectedFile] of Object.entries(EXPECTED_SEND_SITES)) {
      const files = actual.get(context);
      if (!files) {
        missing.push(context);
      } else if (!files.includes(expectedFile)) {
        moved.push(`${context}: expected in ${expectedFile}, found in ${files.join(", ")}`);
      }
    }

    // A missing context means an email the system used to send, it no longer
    // sends. If that removal was deliberate, delete its entry above — the
    // deliberate act is the point.
    expect(missing, "email send sites that have disappeared").toEqual([]);
    expect(moved, "email send sites that moved file").toEqual([]);
  });

  test("every send site in the source is registered here", () => {
    const unregistered = [...actual.keys()].filter(
      (context) => !(context in EXPECTED_SEND_SITES)
    );

    // A new send arriving here unregistered is not a bug in itself — it is a
    // prompt: add it above, and add a runtime test proving it fires.
    expect(unregistered, "unregistered email send sites").toEqual([]);
  });

  test("the inventory is not silently empty", () => {
    // Guards the scanner itself: a broken path or regex would make both tests
    // above pass vacuously.
    expect(actual.size).toBeGreaterThanOrEqual(50);
  });
});
