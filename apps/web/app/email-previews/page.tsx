import { notFound } from "next/navigation";
import {
  welcomeEmail,
  rollcallWelcomeEmail,
  contactNotificationEmail,
  contactAutoReplyEmail,
  accountDeletedEmail,
  orderShippedEmail,
  OrderEmailItem,
  staffInviteEmail,
  customerSetupEmail,
  passwordResetEmail,
  selfServicePasswordResetEmail,
  certReminderEmail,
  invoicePaidEmail,
  invoiceResendEmail,
  invoiceEmail,
  bookingConfirmationEmail,
  classRequestAdminNotificationEmail,
  classRequestCustomerConfirmEmail,
  classRequestApprovedCustomerEmail,
  classRequestRejectedCustomerEmail,
  instructorClassOpportunityEmail,
  instructorAcceptedAdminEmail,
  sessionCancelledAdminEmail,
  openOpportunityInstructorEmail,
  sessionClaimedStudentEmail,
  sessionClaimedAdminEmail,
  unclaimedOpportunityEscalationEmail,
  payoutDeniedAdminEmail,
  instructorPayoutSentEmail,
} from "@/lib/emails";

// Dev-only preview page for all transactional emails.
// Visible only when `NODE_ENV === 'development'`.
export default async function Page() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  // Build sample data for each email and compute a data: URL so the browser
  // can render the full HTML document (wrapEmail returns a complete HTML doc).
  const previews: Array<{
    id: string;
    name: string;
    subject: string;
    src: string;
  }> = [];

  const b64 = (html: string) => `data:text/html;charset=utf-8;base64,${Buffer.from(html).toString("base64")}`;

  // 1) Welcome
  const w = welcomeEmail({ firstName: "Alex" });
  previews.push({ id: "welcome", name: "Welcome", subject: w.subject, src: b64(w.html) });

  // 2) Rollcall welcome
  const r = rollcallWelcomeEmail({ firstName: "Jordan" });
  previews.push({ id: "rollcall", name: "Rollcall Welcome", subject: r.subject, src: b64(r.html) });

  // 3) Contact (business notification)
  const contactBiz = contactNotificationEmail({
    name: "Alex Visitor",
    email: "alex.visitor@example.com",
    phone: "(555) 123-4567",
    inquiryType: "General",
    message: "Hi — I'd like more info about your onsite classes.\nThanks!",
  });
  previews.push({ id: "contact-biz", name: "Contact (Business)", subject: contactBiz.subject, src: b64(contactBiz.html) });

  // 4) Contact auto-reply
  const contactAuto = contactAutoReplyEmail({ firstName: "Alex" });
  previews.push({ id: "contact-auto", name: "Contact (Auto Reply)", subject: contactAuto.subject, src: b64(contactAuto.html) });

  // 5) Account deleted
  const acct = accountDeletedEmail({ firstName: "Alex" });
  previews.push({ id: "account-deleted", name: "Account Deleted", subject: acct.subject, src: b64(acct.html) });

  // 6) Order shipped
  const items: OrderEmailItem[] = [
    { productName: "SuperHero Tee", size: "M", quantity: 1, priceAtPurchase: 24.99 },
    { productName: "CPR Sticker", size: "-", quantity: 2, priceAtPurchase: 3.5 },
  ];
  const shipped = orderShippedEmail({
    firstName: "Alex",
    trackingNumber: "1Z999AA10123456784",
    carrier: "UPS",
    items,
    totalAmount: 31.99,
    shippingName: "Alex Visitor",
    shippingCity: "Tampa",
    shippingState: "FL",
  });
  previews.push({ id: "order-shipped", name: "Order Shipped", subject: shipped.subject, src: b64(shipped.html) });

  // 7) Staff invite
  const invite = staffInviteEmail({
    firstName: "Taylor",
    personalMessage: "Welcome to the team — excited to have you!",
    roleLabel: "Instructor",
    actionLink: "https://superherocpr.com/set-password?token=dev-example",
    isInstructor: true,
  });
  previews.push({ id: "staff-invite", name: "Staff Invite", subject: invite.subject, src: b64(invite.html) });

  // 8) Customer setup
  const setup = customerSetupEmail({ firstName: "Alex", setupLink: "https://superherocpr.com/set-password?token=dev" });
  previews.push({ id: "customer-setup", name: "Customer Setup", subject: setup.subject, src: b64(setup.html) });

  // 9) Password reset (admin-initiated)
  const pw = passwordResetEmail({ firstName: "Alex", actionLink: "https://superherocpr.com/reset?token=dev" });
  previews.push({ id: "password-reset", name: "Password Reset (Admin)", subject: pw.subject, src: b64(pw.html) });

  // 9b) Password reset (self-service via /book/forgot-password)
  const pwSelf = selfServicePasswordResetEmail({ actionLink: "https://superherocpr.com/book/reset-password#access_token=dev&type=recovery" });
  previews.push({ id: "password-reset-self", name: "Password Reset (Self-Service)", subject: pwSelf.subject, src: b64(pwSelf.html) });

  // 10) Cert reminder
  const cert = certReminderEmail({ firstName: "Alex", certName: "BLS for Healthcare Providers", daysRemaining: 45 });
  previews.push({ id: "cert-reminder", name: "Certification Reminder", subject: cert.subject, src: b64(cert.html) });

  // 11) Invoice paid
  const invPaid = invoicePaidEmail({ firstName: "Dana", invoiceNumber: "INV-1001", recipientName: "Acme Inc.", studentCount: 5 });
  previews.push({ id: "invoice-paid", name: "Invoice Paid", subject: invPaid.subject, src: b64(invPaid.html) });

  // 12) Invoice resend
  const invResend = invoiceResendEmail({
    invoiceNumber: "INV-1002",
    recipientName: "Acme Inc.",
    className: "BLS Group Training",
    sessionDate: "2026-06-15T09:00:00.000Z",
    locationName: "Main Street Training Center",
    locationCity: "Tampa",
    locationState: "FL",
    instructorName: "Dana Morgan",
    studentCount: 8,
    totalAmount: 1200,
    notes: "Please pay within 7 days",
    paymentPlatform: "PayPal",
  });
  previews.push({ id: "invoice-resend", name: "Invoice Resend", subject: invResend.subject, src: b64(invResend.html) });

  // 13) New invoice
  const newInv = invoiceEmail({
    invoiceNumber: "INV-1003",
    recipientName: "Acme Inc.",
    invoiceType: "group",
    companyName: "Acme Inc.",
    studentCount: 12,
    totalAmount: 1800,
    className: "BLS for Healthcare Providers",
    classDate: "2026-06-15T09:00:00.000Z",
    locationName: "Main Street Training Center",
    locationCity: "Tampa",
    locationState: "FL",
    instructorName: "Dana Morgan",
    notes: "Bring a list of attendees.",
    paymentLink: "https://pay.superherocpr.com/invoice/INV-1003",
  });
  previews.push({ id: "invoice-new", name: "Invoice (New)", subject: newInv.subject, src: b64(newInv.html) });

  // 14) Booking confirmation
  const booking = bookingConfirmationEmail({
    firstName: "Alex",
    className: "BLS for Healthcare Providers",
    startsAt: "2026-06-15T14:00:00.000Z",
    locationName: "Main Street Training Center",
    locationAddress: "123 Main St",
    locationCity: "Tampa",
    locationState: "FL",
    locationZip: "33602",
    amount: 79.0,
    paymentProcessor: "SuperHeroCPR via PayPal",
    transactionId: "PAYPAL-CAPTURE-12345",
    instructorName: "Dana Morgan",
  });
  previews.push({ id: "booking-confirm", name: "Booking Confirmation", subject: booking.subject, src: b64(booking.html) });

  // ── Customer-Requested Class emails ────────────────────────────────────────
  const crAdmin = classRequestAdminNotificationEmail({
    customerName: "Jordan Smith",
    customerEmail: "jordan.smith@example.com",
    className: "Heartsaver CPR/AED",
    preferredDate: "2026-09-15",
    preferredTimeLabel: "Morning (before noon)",
    groupSize: 12,
    venueName: "Acme Corp. HQ",
    venueCity: "Tampa",
    venueState: "FL",
    requestId: "00000000-0000-0000-0000-000000000001",
    baseUrl: "http://localhost:3000",
  });
  previews.push({ id: "cr-admin-notify", name: "Class Request — Admin Notification", subject: crAdmin.subject, src: b64(crAdmin.html) });

  const crConfirm = classRequestCustomerConfirmEmail({
    firstName: "Jordan",
    className: "Heartsaver CPR/AED",
    preferredDate: "2026-09-15",
    venueName: "Acme Corp. HQ",
  });
  previews.push({ id: "cr-customer-confirm", name: "Class Request — Customer Confirmation", subject: crConfirm.subject, src: b64(crConfirm.html) });

  const crApproved = classRequestApprovedCustomerEmail({
    firstName: "Jordan",
    className: "Heartsaver CPR/AED",
    confirmedDate: "2026-09-15",
    venueName: "Acme Corp. HQ",
  });
  previews.push({ id: "cr-customer-approved", name: "Class Request — Approved (Customer)", subject: crApproved.subject, src: b64(crApproved.html) });

  const crRejected = classRequestRejectedCustomerEmail({
    firstName: "Jordan",
    className: "Heartsaver CPR/AED",
    reason: "We are unable to service that area at this time. Please check back in the future.",
  });
  previews.push({ id: "cr-customer-rejected", name: "Class Request — Rejected (Customer)", subject: crRejected.subject, src: b64(crRejected.html) });

  const crOpportunity = instructorClassOpportunityEmail({
    className: "Heartsaver CPR/AED",
    confirmedDate: "2026-09-15",
    preferredTimeLabel: "Morning (before noon)",
    groupSize: 12,
    venueName: "Acme Corp. HQ",
    venueCity: "Tampa",
    venueState: "FL",
    sessionId: "00000000-0000-0000-0000-000000000002",
    baseUrl: "http://localhost:3000",
  });
  previews.push({ id: "cr-instructor-opportunity", name: "Class Request — Instructor Opportunity", subject: crOpportunity.subject, src: b64(crOpportunity.html) });

  const crAccepted = instructorAcceptedAdminEmail({
    instructorName: "Casey Rivera",
    className: "Heartsaver CPR/AED",
    sessionDate: "2026-09-15T12:00:00Z",
    venueName: "Acme Corp. HQ",
    venueCity: "Tampa",
    venueState: "FL",
    sessionId: "00000000-0000-0000-0000-000000000002",
    baseUrl: "http://localhost:3000",
  });
  previews.push({ id: "cr-instructor-accepted", name: "Class Request — Instructor Accepted (Admin)", subject: crAccepted.subject, src: b64(crAccepted.html) });

  // ── Open Opportunity (cancel → claim) emails ───────────────────────────────
  const ooCancelledAdmin = sessionCancelledAdminEmail({
    className: "BLS for Healthcare Providers",
    sessionDate: "2026-09-15T14:00:00Z",
    venueName: "Main Street Training Center",
    cancelledByName: "Dana Morgan",
    reason: "Family emergency — unable to teach this session.",
    sessionId: "00000000-0000-0000-0000-000000000003",
    baseUrl: "http://localhost:3000",
  });
  previews.push({ id: "oo-cancelled-admin", name: "Session Cancelled — Admin Notification", subject: ooCancelledAdmin.subject, src: b64(ooCancelledAdmin.html) });

  const ooInstructorBroadcast = openOpportunityInstructorEmail({
    className: "BLS for Healthcare Providers",
    sessionDate: "2026-09-15T14:00:00Z",
    venueName: "Main Street Training Center",
    venueCity: "Tampa",
    venueState: "FL",
    sessionId: "00000000-0000-0000-0000-000000000003",
    baseUrl: "http://localhost:3000",
  });
  previews.push({ id: "oo-instructor-broadcast", name: "Open Opportunity — Instructor Broadcast", subject: ooInstructorBroadcast.subject, src: b64(ooInstructorBroadcast.html) });

  const ooClaimedStudent = sessionClaimedStudentEmail({
    firstName: "Alex",
    className: "BLS for Healthcare Providers",
    sessionDate: "2026-09-15T14:00:00Z",
    newInstructorName: "Casey Rivera",
    newInstructorPhone: "(813) 555-0142",
    newVenueName: "Westshore Training Center",
    newVenueCity: "Tampa",
    newVenueState: "FL",
  });
  previews.push({ id: "oo-claimed-student", name: "Session Claimed — Student Notification", subject: ooClaimedStudent.subject, src: b64(ooClaimedStudent.html) });

  const ooClaimedAdmin = sessionClaimedAdminEmail({
    className: "BLS for Healthcare Providers",
    sessionDate: "2026-09-15T14:00:00Z",
    newInstructorName: "Casey Rivera",
    sessionId: "00000000-0000-0000-0000-000000000003",
    baseUrl: "http://localhost:3000",
  });
  previews.push({ id: "oo-claimed-admin", name: "Session Claimed — Admin Notification", subject: ooClaimedAdmin.subject, src: b64(ooClaimedAdmin.html) });

  const ooEscalation = unclaimedOpportunityEscalationEmail({
    sessions: [
      {
        sessionId: "00000000-0000-0000-0000-000000000003",
        className: "BLS for Healthcare Providers",
        sessionDate: "2026-09-15T14:00:00Z",
        venueName: "Main Street Training Center",
      },
      {
        sessionId: "00000000-0000-0000-0000-000000000004",
        className: "Heartsaver CPR/AED",
        sessionDate: "2026-09-16T09:00:00Z",
        venueName: "Acme Corp. HQ",
      },
    ],
    baseUrl: "http://localhost:3000",
  });
  previews.push({ id: "oo-escalation", name: "Unclaimed Opportunities — Super Admin Escalation", subject: ooEscalation.subject, src: b64(ooEscalation.html) });

  const payoutDenied = payoutDeniedAdminEmail({
    senderBatchId: "shcpr-4f2c9a1b8e7d4c3a9f1e2d3c4b5a6978",
    paypalBatchId: "9XJ4K2LMNP8QR",
    totalAmount: 640,
    itemCount: 3,
    paypalStatus: "DENIED",
    baseUrl: "http://localhost:3000",
  });
  previews.push({ id: "payout-denied", name: "Payout Denied — Super Admin Alert", subject: payoutDenied.subject, src: b64(payoutDenied.html) });

  const payoutSent = instructorPayoutSentEmail({
    firstName: "Sarah",
    amount: 320,
    payoutEmail: "sarah.instructor@example.com",
    baseUrl: "http://localhost:3000",
  });
  previews.push({ id: "payout-sent", name: "Instructor Payout Sent", subject: payoutSent.subject, src: b64(payoutSent.html) });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">Email Previews (dev only)</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {previews.map((p) => (
          <section key={p.id} className="border rounded-md overflow-hidden bg-white shadow-sm">
            <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-600">{p.subject}</div>
              </div>
              <div>
                <a className="text-sm text-red-600 hover:underline" href={p.src} target="_blank" rel="noreferrer">
                  Open in new tab
                </a>
              </div>
            </div>
            <div style={{ height: 480 }}>
              <iframe src={p.src} className="w-full h-full" title={p.name} />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
