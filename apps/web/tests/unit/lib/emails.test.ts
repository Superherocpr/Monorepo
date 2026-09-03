/**
 * Unit tests for lib/emails.ts — the template layer.
 *
 * These lock in four properties that a follow-up audit found broken. Each one is
 * invisible to the type checker, which is why they survived: every value
 * involved is a `string`, so TypeScript is satisfied whether or not it was
 * escaped, and `${null}` is a perfectly legal template interpolation.
 *
 *   1. No template may ever print the literal text "null" where a value is
 *      missing. `bookingConfirmationEmail` did exactly that — "Call us at null"
 *      — for every instructor with no phone on file.
 *   2. User- and staff-supplied free text must be HTML-escaped in the body.
 *      Invoice notes, recipient names, and shipping details were interpolated raw.
 *   3. Subject lines are plain text, NOT HTML. Passing an escaped value there
 *      shows the recipient a literal "&amp;".
 *   4. Escaping must survive at the boundaries — an apostrophe in a real name
 *      like "O'Brien" must not corrupt the rendered output.
 */
import { describe, test, expect } from "vitest";
import {
  bookingConfirmationEmail,
  invoiceEmail,
  invoiceResendEmail,
  invoicePaidEmail,
  invoicePaymentConfirmedCustomerEmail,
  orderShippedEmail,
  accountDeletedEmail,
  customerSetupEmail,
  passwordResetEmail,
  bookingCancelledEmail,
  instructorBookingNotificationEmail,
  escapeHtml,
} from "@/lib/emails";
import { BUSINESS_PHONE } from "@/lib/constants";

/** A hostile string covering every character escapeHtml handles. */
const XSS = `<script>alert('x')</script>&"`;

/** Minimum viable args for bookingConfirmationEmail. */
function bookingArgs(over: Record<string, unknown> = {}) {
  return {
    firstName: "Dana",
    className: "BLS Provider",
    startsAt: "2026-10-01T14:00:00",
    locationName: "HQ",
    locationAddress: "1 Main St",
    locationCity: "Tampa",
    locationState: "FL",
    locationZip: "33601",
    amount: 75,
    paymentProcessor: "SuperHeroCPR via PayPal",
    transactionId: "TX123",
    ...over,
  };
}

describe("Bug 1 — a missing value must never render as the text 'null'", () => {
  test("booking confirmation falls back to the business phone when the instructor has none", () => {
    // 5 of 6 active production instructors had no phone, so this was the
    // default path for the most-sent customer-facing email in the system.
    const { html } = bookingConfirmationEmail(
      bookingArgs({ instructorName: "Alex Lee", instructorPhone: null })
    );

    expect(html).not.toContain("Call us at null");
    expect(html).toContain(`Call us at ${BUSINESS_PHONE}`);
  });

  test("booking confirmation prefers the instructor's phone when present", () => {
    const { html } = bookingConfirmationEmail(
      bookingArgs({ instructorName: "Alex Lee", instructorPhone: "(813) 555-0147" })
    );

    expect(html).toContain("Call us at (813) 555-0147");
  });

  test("no template emits a bare 'null' or 'undefined' when optional fields are absent", () => {
    const rendered = [
      bookingConfirmationEmail(
        bookingArgs({ instructorName: null, instructorEmail: null, instructorPhone: null, transactionId: null })
      ),
      invoiceResendEmail({
        invoiceNumber: "INV-1",
        recipientName: "Dana",
        className: "BLS",
        sessionDate: null,
        locationName: "HQ",
        locationCity: "Tampa",
        locationState: "FL",
        instructorName: null,
        studentCount: 3,
        totalAmount: null,
        notes: null,
        paymentPlatform: null,
      }),
      invoiceEmail({
        invoiceNumber: "INV-2",
        recipientName: "Dana",
        invoiceType: "individual",
        companyName: null,
        studentCount: 1,
        totalAmount: 75,
        className: "BLS",
        classDate: "2026-10-01T14:00:00",
        locationName: "HQ",
        locationCity: "Tampa",
        locationState: "FL",
        instructorName: null,
        notes: null,
        paymentLink: null,
      }),
    ];

    for (const { html, subject } of rendered) {
      expect(html).not.toMatch(/>\s*null\s*</);
      expect(html).not.toContain("undefined");
      expect(subject).not.toContain("null");
      expect(subject).not.toContain("undefined");
    }
  });
});

describe("Bug 2 — user- and staff-supplied text is escaped in the HTML body", () => {
  test("invoice notes and payment link are escaped", () => {
    // Notes are free text typed by staff, and paymentLink lands inside an href —
    // the two fields an attacker or a careless paste is most likely to reach.
    const { html } = invoiceEmail({
      invoiceNumber: "INV-1",
      recipientName: XSS,
      invoiceType: "group",
      companyName: XSS,
      studentCount: 4,
      totalAmount: 300,
      className: XSS,
      classDate: "2026-10-01T14:00:00",
      locationName: XSS,
      locationCity: "Tampa",
      locationState: "FL",
      instructorName: XSS,
      notes: XSS,
      paymentLink: `https://x.example/"onmouseover="alert(1)`,
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    // The crafted link must not be able to close the href and add an attribute.
    expect(html).not.toContain('"onmouseover="');
  });

  test("invoiceResendEmail escapes every free-text field", () => {
    const { html } = invoiceResendEmail({
      invoiceNumber: "INV-1",
      recipientName: XSS,
      className: XSS,
      sessionDate: null,
      locationName: XSS,
      locationCity: XSS,
      locationState: XSS,
      instructorName: XSS,
      studentCount: 2,
      totalAmount: 100,
      notes: XSS,
      paymentPlatform: XSS,
    });

    expect(html).not.toContain("<script>");
  });

  test("order shipping details from the customer are escaped", () => {
    const { html } = orderShippedEmail({
      firstName: XSS,
      trackingNumber: XSS,
      carrier: XSS,
      items: [{ productName: XSS, size: XSS, quantity: 1, priceAtPurchase: 10 }],
      totalAmount: 10,
      shippingName: XSS,
      shippingCity: XSS,
      shippingState: XSS,
    });

    expect(html).not.toContain("<script>");
  });

  test("account, setup, and reset emails escape the customer's name", () => {
    for (const { html } of [
      accountDeletedEmail({ firstName: XSS }),
      customerSetupEmail({ firstName: XSS, setupLink: "https://x.example/a" }),
      passwordResetEmail({ firstName: XSS, actionLink: "https://x.example/a" }),
    ]) {
      expect(html).not.toContain("<script>");
    }
  });

  test("invoice paid + payment-confirmed emails escape names and numbers", () => {
    const paid = invoicePaidEmail({
      firstName: XSS,
      invoiceNumber: XSS,
      recipientName: XSS,
      studentCount: 2,
    });
    const confirmed = invoicePaymentConfirmedCustomerEmail({
      recipientName: XSS,
      invoiceNumber: XSS,
      invoiceType: "individual",
      className: XSS,
      classDate: "2026-10-01T14:00:00",
      totalAmount: 75,
    });

    expect(paid.html).not.toContain("<script>");
    expect(confirmed.html).not.toContain("<script>");
  });

  test("a real apostrophe name renders escaped, not broken", () => {
    const { html } = bookingConfirmationEmail(bookingArgs({ firstName: "O'Brien" }));

    // The point is not that apostrophes are dangerous — it is that escaping is
    // applied consistently, so the entity is what appears.
    expect(html).toContain("O&#x27;Brien");
  });
});

describe("Bug 3 — subject lines are plain text and must not carry HTML entities", () => {
  test("an ampersand in a class name survives the subject unescaped", () => {
    const { subject, html } = bookingConfirmationEmail(
      bookingArgs({ className: "First Aid & CPR" })
    );

    expect(subject).toContain("First Aid & CPR");
    expect(subject).not.toContain("&amp;");
    // The body still escapes it — the two contexts have different rules.
    expect(html).toContain("First Aid &amp; CPR");
  });

  test("other subject-bearing templates are entity-free too", () => {
    const cancelled = bookingCancelledEmail({
      firstName: "Dana",
      className: "First Aid & CPR",
      startsAt: "2026-10-01T14:00:00",
    });
    const notification = instructorBookingNotificationEmail({
      instructorFirstName: "Alex",
      customerName: "Dana",
      className: "First Aid & CPR",
      startsAt: "2026-10-01T14:00:00",
      locationName: "HQ",
      source: "online",
    });

    expect(cancelled.subject).not.toContain("&amp;");
    expect(notification.subject).not.toContain("&amp;");
  });
});

describe("escapeHtml", () => {
  test("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#x27;");
  });

  test("escapes the ampersand first so entities are not double-encoded", () => {
    // A naive implementation that replaced & last would turn "<" into "&amp;lt;".
    expect(escapeHtml("<")).toBe("&lt;");
  });
});
