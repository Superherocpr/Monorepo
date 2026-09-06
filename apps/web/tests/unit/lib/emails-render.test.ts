/**
 * Render contract for EVERY email template in lib/emails.ts.
 *
 * The other email test files check specific known bugs. This one checks the
 * whole surface: every exported template is rendered twice — once with a full
 * set of values, once with every optional field null — and both results must
 * satisfy the properties that make an email safe to actually send.
 *
 * The properties, and why each is here:
 *
 *   - **Non-empty subject and body.** A template that throws or returns "" is
 *     a silently broken email; Resend would happily send the blank.
 *   - **No "null" / "undefined" / "[object Object]" / "NaN" in the body.** This
 *     is the class of bug that put "Call us at null." in front of real
 *     customers. The sparse fixture is what actually catches it — every
 *     optional field is null there, which is the production default for a
 *     half-filled record.
 *   - **No HTML entities in the subject.** Subjects are plain text delivered
 *     via MIME headers; "&amp;" there reaches the inbox literally.
 *   - **No newlines in the subject.** A CR or LF in a header value is email
 *     header injection — it would let arbitrary text become a new header.
 *
 * The `covers every exported template` test is what makes this file hold its
 * value: adding a template to lib/emails.ts without adding it here fails.
 */
import { describe, test, expect } from "vitest";
import * as emailModule from "@/lib/emails";
import type { EmailContent } from "@/lib/emails";
import {
  welcomeEmail,
  rollcallWelcomeEmail,
  contactNotificationEmail,
  contactAutoReplyEmail,
  accountDeletedEmail,
  orderShippedEmail,
  staffInviteEmail,
  customerSetupEmail,
  passwordResetEmail,
  certReminderEmail,
  invoicePaidEmail,
  invoiceResendEmail,
  bookingConfirmationEmail,
  invoiceEmail,
  selfServicePasswordResetEmail,
  classRequestAdminNotificationEmail,
  classRequestCustomerConfirmEmail,
  classRequestApprovedCustomerEmail,
  classRequestRejectedCustomerEmail,
  instructorClassOpportunityEmail,
  instructorAcceptedAdminEmail,
  instructorConfirmedCustomerEmail,
  invoicePaymentConfirmedCustomerEmail,
  sessionCancelledAdminEmail,
  openOpportunityInstructorEmail,
  sessionClaimedStudentEmail,
  sessionClaimedAdminEmail,
  unclaimedOpportunityEscalationEmail,
  assistantNeededEmail,
  payoutDeniedAdminEmail,
  payoutStuckDigestAdminEmail,
  instructorPayoutSentEmail,
  bookingCancelledEmail,
  instructorBookingNotificationEmail,
  dailySummaryEmail,
  teamBookingCreatedEmail,
  teamSignupConfirmationEmail,
  teamInvoiceMissingAdminEmail,
} from "@/lib/emails";

const ISO = "2026-10-01T14:00:00";
const BASE_URL = "https://superherocpr.com";

/** A healthy invariant summary for the daily digest. */
const HEALTH_OK = {
  checksRun: 12,
  breachedCount: 0,
  criticalBreaches: 0,
  warningBreaches: 0,
  healthy: true,
  breached: [],
};

/** A breached invariant summary — exercises the red banner branch. */
const HEALTH_BAD = {
  checksRun: 12,
  breachedCount: 1,
  criticalBreaches: 3,
  warningBreaches: 0,
  healthy: false,
  breached: [
    {
      checkName: "booking_missing_payment",
      severity: "critical" as const,
      breachCount: 3,
      detail: "Bookings with no matching payment row",
    },
  ],
};

const CRON_OK = { jobsTracked: 9, overdue: [], healthy: true };

const CRON_BAD = {
  jobsTracked: 9,
  healthy: false,
  overdue: [
    {
      jobName: "daily-summary",
      schedule: "0 12 * * *",
      lastSuccess: "2026-09-01T12:00:00Z",
      minutesSince: 2880,
      maxGapMinutes: 1500,
      isOverdue: true,
    },
  ],
};

/**
 * One template under test: a full-value render and a sparse (all-optionals-null)
 * render. `sparse` is omitted for templates whose parameters are all required.
 */
interface Fixture {
  full: () => EmailContent;
  sparse?: () => EmailContent;
}

const FIXTURES: Record<string, Fixture> = {
  welcomeEmail: {
    full: () => welcomeEmail({ firstName: "Dana" }),
  },

  rollcallWelcomeEmail: {
    full: () => rollcallWelcomeEmail({ firstName: "Dana" }),
  },

  contactNotificationEmail: {
    full: () =>
      contactNotificationEmail({
        name: "Dana Scully",
        email: "dana@example.com",
        phone: "(813) 555-0100",
        inquiryType: "Group booking",
        message: "Do you offer weekend classes?\nWe have 12 staff.",
      }),
    sparse: () =>
      contactNotificationEmail({
        name: "Dana Scully",
        email: "dana@example.com",
        phone: null,
        inquiryType: "General",
        message: "Hello",
      }),
  },

  contactAutoReplyEmail: {
    full: () => contactAutoReplyEmail({ firstName: "Dana" }),
  },

  accountDeletedEmail: {
    full: () => accountDeletedEmail({ firstName: "Dana" }),
  },

  orderShippedEmail: {
    full: () =>
      orderShippedEmail({
        firstName: "Dana",
        trackingNumber: "1Z999AA10123456784",
        carrier: "UPS",
        items: [{ productName: "Hero Tee", size: "L", quantity: 2, priceAtPurchase: 24.99 }],
        totalAmount: 49.98,
        shippingName: "Dana Scully",
        shippingCity: "Tampa",
        shippingState: "FL",
      }),
    sparse: () =>
      orderShippedEmail({
        firstName: "Dana",
        trackingNumber: "1Z999AA10123456784",
        carrier: null,
        items: [{ productName: "Hero Tee", size: "L", quantity: 1, priceAtPurchase: 24.99 }],
        totalAmount: 24.99,
        shippingName: "Dana Scully",
        shippingCity: "Tampa",
        shippingState: "FL",
      }),
  },

  staffInviteEmail: {
    full: () =>
      staffInviteEmail({
        firstName: "Alex",
        personalMessage: "Excited to have you aboard.",
        roleLabel: "Instructor",
        actionLink: `${BASE_URL}/setup-password?token_hash=abc&type=recovery`,
        isInstructor: true,
      }),
    sparse: () =>
      staffInviteEmail({
        firstName: "Alex",
        personalMessage: null,
        roleLabel: "Manager",
        actionLink: `${BASE_URL}/setup-password?token_hash=abc&type=recovery`,
        isInstructor: false,
      }),
  },

  customerSetupEmail: {
    full: () => customerSetupEmail({ firstName: "Dana", setupLink: `${BASE_URL}/setup` }),
  },

  passwordResetEmail: {
    full: () => passwordResetEmail({ firstName: "Dana", actionLink: `${BASE_URL}/reset` }),
  },

  certReminderEmail: {
    full: () =>
      certReminderEmail({ firstName: "Dana", certName: "BLS Provider", daysRemaining: 30 }),
    // daysRemaining: 1 exercises the singular "day" branch.
    sparse: () =>
      certReminderEmail({ firstName: "Dana", certName: "BLS Provider", daysRemaining: 1 }),
  },

  invoicePaidEmail: {
    full: () =>
      invoicePaidEmail({
        firstName: "Alex",
        invoiceNumber: "INV-1042",
        recipientName: "Tampa General",
        studentCount: 8,
      }),
  },

  invoiceResendEmail: {
    full: () =>
      invoiceResendEmail({
        invoiceNumber: "INV-1042",
        recipientName: "Tampa General",
        className: "BLS Provider",
        sessionDate: ISO,
        locationName: "HQ",
        locationCity: "Tampa",
        locationState: "FL",
        instructorName: "Alex Lee",
        studentCount: 8,
        totalAmount: 600,
        notes: "Please pay within 30 days.",
        paymentPlatform: "PayPal",
      }),
    sparse: () =>
      invoiceResendEmail({
        invoiceNumber: "INV-1042",
        recipientName: "Tampa General",
        className: "BLS Provider",
        sessionDate: null,
        locationName: "HQ",
        locationCity: "Tampa",
        locationState: "FL",
        instructorName: null,
        studentCount: 8,
        totalAmount: null,
        notes: null,
        paymentPlatform: null,
      }),
  },

  bookingConfirmationEmail: {
    full: () =>
      bookingConfirmationEmail({
        firstName: "Dana",
        className: "BLS Provider",
        startsAt: ISO,
        locationName: "HQ",
        locationAddress: "1 Main St",
        locationCity: "Tampa",
        locationState: "FL",
        locationZip: "33601",
        amount: 75,
        paymentProcessor: "SuperHeroCPR via PayPal",
        transactionId: "TX123",
        instructorName: "Alex Lee",
        instructorEmail: "alex@example.com",
        instructorPhone: "(813) 555-0147",
        addons: [{ name: "Pocket Mask", price: 12.5 }],
      }),
    sparse: () =>
      bookingConfirmationEmail({
        firstName: null,
        className: "BLS Provider",
        startsAt: ISO,
        locationName: "HQ",
        locationAddress: "1 Main St",
        locationCity: "Tampa",
        locationState: "FL",
        locationZip: "33601",
        amount: 75,
        paymentProcessor: "SuperHeroCPR via PayPal",
        transactionId: null,
        instructorName: null,
        instructorEmail: null,
        instructorPhone: null,
      }),
  },

  invoiceEmail: {
    full: () =>
      invoiceEmail({
        invoiceNumber: "INV-1042",
        recipientName: "Tampa General",
        invoiceType: "group",
        companyName: "Tampa General Hospital",
        studentCount: 8,
        totalAmount: 600,
        className: "BLS Provider",
        classDate: ISO,
        locationName: "HQ",
        locationCity: "Tampa",
        locationState: "FL",
        instructorName: "Alex Lee",
        notes: "Net 30.",
        paymentLink: `${BASE_URL}/pay/INV-1042`,
      }),
    sparse: () =>
      invoiceEmail({
        invoiceNumber: "INV-1042",
        recipientName: "Dana Scully",
        invoiceType: "individual",
        companyName: null,
        studentCount: 1,
        totalAmount: 75,
        className: "BLS Provider",
        classDate: ISO,
        locationName: "HQ",
        locationCity: "Tampa",
        locationState: "FL",
        instructorName: null,
        notes: null,
        paymentLink: null,
      }),
  },

  selfServicePasswordResetEmail: {
    full: () => selfServicePasswordResetEmail({ actionLink: `${BASE_URL}/book/reset-password` }),
  },

  classRequestAdminNotificationEmail: {
    full: () =>
      classRequestAdminNotificationEmail({
        customerName: "Dana Scully",
        customerEmail: "dana@example.com",
        className: "BLS Provider",
        preferredDate: ISO,
        preferredTimeLabel: "Morning",
        groupSize: 12,
        venueName: "Tampa General",
        venueCity: "Tampa",
        venueState: "FL",
        requestId: "req-1",
        baseUrl: BASE_URL,
      }),
  },

  classRequestCustomerConfirmEmail: {
    full: () =>
      classRequestCustomerConfirmEmail({
        firstName: "Dana",
        className: "BLS Provider",
        preferredDate: ISO,
        venueName: "Tampa General",
      }),
  },

  classRequestApprovedCustomerEmail: {
    full: () =>
      classRequestApprovedCustomerEmail({
        firstName: "Dana",
        className: "BLS Provider",
        confirmedDate: ISO,
        venueName: "Tampa General",
      }),
  },

  classRequestRejectedCustomerEmail: {
    full: () =>
      classRequestRejectedCustomerEmail({
        firstName: "Dana",
        className: "BLS Provider",
        reason: "No instructor available that week.",
      }),
  },

  instructorClassOpportunityEmail: {
    full: () =>
      instructorClassOpportunityEmail({
        className: "BLS Provider",
        confirmedDate: ISO,
        preferredTimeLabel: "Morning",
        groupSize: 12,
        venueName: "Tampa General",
        venueCity: "Tampa",
        venueState: "FL",
        sessionId: "sess-1",
        baseUrl: BASE_URL,
      }),
  },

  instructorAcceptedAdminEmail: {
    full: () =>
      instructorAcceptedAdminEmail({
        instructorName: "Alex Lee",
        className: "BLS Provider",
        sessionDate: ISO,
        venueName: "Tampa General",
        venueCity: "Tampa",
        venueState: "FL",
        sessionId: "sess-1",
        baseUrl: BASE_URL,
      }),
  },

  instructorConfirmedCustomerEmail: {
    full: () =>
      instructorConfirmedCustomerEmail({
        firstName: "Dana",
        instructorName: "Alex Lee",
        className: "BLS Provider",
        sessionDate: ISO,
        venueName: "Tampa General",
        venueCity: "Tampa",
        venueState: "FL",
      }),
  },

  invoicePaymentConfirmedCustomerEmail: {
    full: () =>
      invoicePaymentConfirmedCustomerEmail({
        recipientName: "Tampa General",
        invoiceNumber: "INV-1042",
        invoiceType: "group",
        className: "BLS Provider",
        classDate: ISO,
        totalAmount: 600,
      }),
    sparse: () =>
      invoicePaymentConfirmedCustomerEmail({
        recipientName: "Dana Scully",
        invoiceNumber: "INV-1043",
        invoiceType: "individual",
        className: "BLS Provider",
        classDate: ISO,
        totalAmount: 75,
      }),
  },

  sessionCancelledAdminEmail: {
    full: () =>
      sessionCancelledAdminEmail({
        className: "BLS Provider",
        sessionDate: ISO,
        venueName: "HQ",
        cancelledByName: "Alex Lee",
        reason: "Instructor unavailable.",
        sessionId: "sess-1",
        baseUrl: BASE_URL,
      }),
  },

  openOpportunityInstructorEmail: {
    full: () =>
      openOpportunityInstructorEmail({
        className: "BLS Provider",
        sessionDate: ISO,
        venueName: "HQ",
        venueCity: "Tampa",
        venueState: "FL",
        sessionId: "sess-1",
        baseUrl: BASE_URL,
      }),
  },

  sessionClaimedStudentEmail: {
    full: () =>
      sessionClaimedStudentEmail({
        firstName: "Dana",
        className: "BLS Provider",
        sessionDate: ISO,
        newInstructorName: "Alex Lee",
        newInstructorPhone: "(813) 555-0147",
        newVenueName: "HQ",
        newVenueCity: "Tampa",
        newVenueState: "FL",
      }),
    sparse: () =>
      sessionClaimedStudentEmail({
        firstName: "Dana",
        className: "BLS Provider",
        sessionDate: ISO,
        newInstructorName: "Alex Lee",
        newInstructorPhone: null,
        newVenueName: "HQ",
        newVenueCity: "Tampa",
        newVenueState: "FL",
      }),
  },

  sessionClaimedAdminEmail: {
    full: () =>
      sessionClaimedAdminEmail({
        className: "BLS Provider",
        sessionDate: ISO,
        newInstructorName: "Alex Lee",
        sessionId: "sess-1",
        baseUrl: BASE_URL,
      }),
  },

  unclaimedOpportunityEscalationEmail: {
    full: () =>
      unclaimedOpportunityEscalationEmail({
        sessions: [
          {
            sessionId: "sess-1",
            className: "BLS Provider",
            sessionDate: ISO,
            venueName: "Tampa General",
          },
          {
            sessionId: "sess-2",
            className: "Heartsaver First Aid",
            sessionDate: ISO,
            venueName: "HQ",
          },
        ],
        baseUrl: BASE_URL,
      }),
    // Single session exercises the singular "class" wording branch.
    sparse: () =>
      unclaimedOpportunityEscalationEmail({
        sessions: [
          {
            sessionId: "sess-1",
            className: "BLS Provider",
            sessionDate: ISO,
            venueName: "Tampa General",
          },
        ],
        baseUrl: BASE_URL,
      }),
  },

  assistantNeededEmail: {
    full: () =>
      assistantNeededEmail({
        instructorName: "Alex Lee",
        className: "BLS Provider",
        sessionDate: ISO,
        studentCount: 9,
        sessionId: "sess-1",
        baseUrl: BASE_URL,
      }),
  },

  payoutDeniedAdminEmail: {
    full: () =>
      payoutDeniedAdminEmail({
        senderBatchId: "batch-1",
        paypalBatchId: "PP-BATCH-1",
        totalAmount: 450,
        itemCount: 3,
        paypalStatus: "DENIED",
        baseUrl: BASE_URL,
      }),
    sparse: () =>
      payoutDeniedAdminEmail({
        senderBatchId: "batch-1",
        paypalBatchId: null,
        totalAmount: 450,
        itemCount: 1,
        paypalStatus: "DENIED",
        baseUrl: BASE_URL,
      }),
  },

  payoutStuckDigestAdminEmail: {
    full: () =>
      payoutStuckDigestAdminEmail({
        batches: [
          {
            senderBatchId: "batch-1",
            status: "PENDING",
            totalAmount: 450,
            itemCount: 3,
            createdAt: "2026-09-01T10:00:00Z",
            denialReason: "Receiver account restricted",
          },
        ],
        baseUrl: BASE_URL,
      }),
    sparse: () =>
      payoutStuckDigestAdminEmail({
        batches: [
          {
            senderBatchId: "batch-1",
            status: "PENDING",
            totalAmount: 450,
            itemCount: 3,
            createdAt: "2026-09-01T10:00:00Z",
            denialReason: null,
          },
        ],
        baseUrl: BASE_URL,
      }),
  },

  instructorPayoutSentEmail: {
    full: () =>
      instructorPayoutSentEmail({
        firstName: "Alex",
        amount: 150,
        payoutEmail: "alex@example.com",
        baseUrl: BASE_URL,
      }),
  },

  bookingCancelledEmail: {
    full: () =>
      bookingCancelledEmail({ firstName: "Dana", className: "BLS Provider", startsAt: ISO }),
  },

  instructorBookingNotificationEmail: {
    full: () =>
      instructorBookingNotificationEmail({
        instructorFirstName: "Alex",
        customerName: "Dana Scully",
        className: "BLS Provider",
        startsAt: ISO,
        locationName: "HQ",
        source: "online",
      }),
    sparse: () =>
      instructorBookingNotificationEmail({
        instructorFirstName: null,
        customerName: "Dana Scully",
        className: "BLS Provider",
        startsAt: ISO,
        locationName: "HQ",
        source: "manual",
      }),
  },

  dailySummaryEmail: {
    full: () =>
      dailySummaryEmail({
        dateLabel: "Wednesday, September 3, 2026",
        adminUrl: `${BASE_URL}/admin`,
        health: HEALTH_OK,
        cronHealth: CRON_OK,
        totalRevenue: 1250,
        revenueBreakdown: [{ type: "booking", count: 5, total: 1250 }],
        bookings: [
          {
            customerName: "Dana Scully",
            instructorName: "Alex Lee",
            classType: "BLS Provider",
            classDate: "Oct 1, 2026",
            location: "HQ",
          },
        ],
        classRequests: [
          {
            requesterName: "Tampa General",
            classType: "BLS Provider",
            preferredDate: "Oct 8, 2026",
            timeOfDay: "morning",
            groupSize: 12,
            city: "Tampa",
            state: "FL",
            status: "pending",
          },
        ],
        contactSubmissions: [{ name: "Fox Mulder", inquiryType: "Group booking" }],
        todayClasses: [
          {
            classType: "BLS Provider",
            instructorName: "Alex Lee",
            startsAt: "9:00 AM",
            location: "HQ",
            enrolled: 6,
            maxCapacity: 10,
          },
        ],
        newInvoicesCount: 2,
        outstandingInvoicesCount: 3,
        outstandingInvoicesTotal: 1800,
        newCustomersCount: 4,
        pendingClassApprovalsCount: 1,
      }),
    // The empty-everything digest: every section hits its "nothing here" branch,
    // and both health banners go red. This is the shape sent on a quiet Sunday.
    sparse: () =>
      dailySummaryEmail({
        dateLabel: "Sunday, September 7, 2026",
        adminUrl: `${BASE_URL}/admin`,
        health: HEALTH_BAD,
        cronHealth: CRON_BAD,
        totalRevenue: 0,
        revenueBreakdown: [],
        bookings: [],
        classRequests: [],
        contactSubmissions: [],
        todayClasses: [],
        newInvoicesCount: 0,
        outstandingInvoicesCount: 0,
        outstandingInvoicesTotal: 0,
        newCustomersCount: 0,
        pendingClassApprovalsCount: 0,
      }),
  },

  teamBookingCreatedEmail: {
    full: () =>
      teamBookingCreatedEmail({
        staffFirstName: "Alex",
        companyName: "Tampa General",
        contactName: "Dana Scully",
        className: "BLS Provider",
        startsAt: ISO,
        locationName: "HQ",
        shareUrl: `${BASE_URL}/team/abc123`,
        paymentMode: "company",
        priceLabel: "$600 total",
        invoiceNumber: "INV-1042",
        pendingApproval: false,
      }),
    sparse: () =>
      teamBookingCreatedEmail({
        staffFirstName: null,
        companyName: "Tampa General",
        contactName: "Dana Scully",
        className: "BLS Provider",
        startsAt: ISO,
        locationName: "HQ",
        shareUrl: `${BASE_URL}/team/abc123`,
        paymentMode: "per_seat",
        priceLabel: "$75 per seat",
        invoiceNumber: null,
        pendingApproval: true,
      }),
  },

  teamInvoiceMissingAdminEmail: {
    full: () =>
      teamInvoiceMissingAdminEmail({
        bookings: [
          {
            teamBookingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            companyName: "Tampa General",
            contactName: "Dana Scully",
            contactEmail: "dana@tgh.example",
            totalPrice: 1020,
            createdAt: "2026-09-04T21:53:00Z",
            classDate: ISO,
            lastError: "PayPal accepted the invoice but returned no invoice id.",
          },
        ],
        trigger: "sweep",
        baseUrl: BASE_URL,
      }),
    sparse: () =>
      teamInvoiceMissingAdminEmail({
        bookings: [
          {
            teamBookingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            companyName: "Tampa General",
            contactName: "Dana Scully",
            contactEmail: "dana@tgh.example",
            totalPrice: 0,
            createdAt: "2026-09-04T21:53:00Z",
            classDate: null,
            lastError: null,
          },
        ],
        trigger: "booking",
        baseUrl: BASE_URL,
      }),
  },

  teamSignupConfirmationEmail: {
    full: () =>
      teamSignupConfirmationEmail({
        firstName: "Dana",
        companyName: "Tampa General",
        className: "BLS Provider",
        startsAt: ISO,
        locationName: "HQ",
        locationAddress: "1 Main St",
        locationCity: "Tampa",
        locationState: "FL",
        locationZip: "33601",
        amountPaid: 75,
        companyPaid: false,
        instructorName: "Alex Lee",
        cancellationPhone: "(813) 966-3969",
      }),
    sparse: () =>
      teamSignupConfirmationEmail({
        firstName: null,
        companyName: "Tampa General",
        className: "BLS Provider",
        startsAt: ISO,
        locationName: "HQ",
        locationAddress: "1 Main St",
        locationCity: "Tampa",
        locationState: "FL",
        locationZip: "33601",
        amountPaid: 0,
        companyPaid: true,
        instructorName: null,
        cancellationPhone: "(813) 966-3969",
      }),
  },
};

/**
 * Asserts the universal properties every rendered email must satisfy.
 * @param label - Template name plus variant, used in failure messages.
 * @param result - The rendered { subject, html }.
 */
function assertRenderContract(label: string, result: EmailContent): void {
  const { subject, html } = result;

  // ── Subject ────────────────────────────────────────────────────────────────
  expect(subject, `${label}: subject must be a string`).toBeTypeOf("string");
  expect(subject.trim(), `${label}: subject must not be empty`).not.toBe("");

  // Subjects are plain text in a MIME header, not HTML.
  expect(subject, `${label}: subject must not contain HTML entities`).not.toMatch(
    /&(amp|lt|gt|quot|#x27);/
  );
  // A CR/LF in a header value is header injection.
  expect(subject, `${label}: subject must be a single line`).not.toMatch(/[\r\n]/);
  expect(subject, `${label}: subject leaked a null/undefined`).not.toMatch(
    /\b(null|undefined)\b/
  );

  // ── Body ───────────────────────────────────────────────────────────────────
  expect(html, `${label}: html must be a string`).toBeTypeOf("string");
  expect(html.trim(), `${label}: html must not be empty`).not.toBe("");
  expect(html, `${label}: html must contain markup`).toMatch(/<[a-z]/i);

  expect(html, `${label}: leaked the text "undefined"`).not.toContain("undefined");
  expect(html, `${label}: leaked "[object Object]"`).not.toContain("[object Object]");
  expect(html, `${label}: leaked "NaN"`).not.toContain("NaN");
  // An empty table cell rendered from a missing value, e.g. "<td>null</td>".
  expect(html, `${label}: rendered a bare null in an element`).not.toMatch(/>\s*null\s*</);
  // A missing value inline in a sentence, e.g. "Call us at null." — the exact
  // shape of the bug that reached production.
  expect(html, `${label}: rendered a bare null in a sentence`).not.toMatch(/\bnull\b\s*[.,!)]/);
}

describe("every template renders a sendable email", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name} — full values`, () => {
      assertRenderContract(`${name} (full)`, fixture.full());
    });

    if (fixture.sparse) {
      test(`${name} — optional fields null`, () => {
        assertRenderContract(`${name} (sparse)`, fixture.sparse!());
      });
    }
  }
});

describe("fixture coverage", () => {
  test("covers every exported template in lib/emails.ts", () => {
    // Everything callable that the module exports, minus the escaping helper,
    // is an email template and must have a fixture above.
    const exported = Object.entries(emailModule)
      .filter(([name, value]) => typeof value === "function" && name !== "escapeHtml")
      .map(([name]) => name)
      .sort();

    const covered = Object.keys(FIXTURES).sort();

    // Named this way so a failure prints the missing template, not just a count.
    expect(exported.filter((name) => !covered.includes(name))).toEqual([]);
    expect(covered.filter((name) => !exported.includes(name))).toEqual([]);
  });
});
