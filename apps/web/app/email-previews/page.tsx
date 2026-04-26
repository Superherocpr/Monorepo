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
  certReminderEmail,
  invoicePaidEmail,
  invoiceResendEmail,
  invoiceEmail,
  bookingConfirmationEmail,
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

  // 9) Password reset
  const pw = passwordResetEmail({ firstName: "Alex", actionLink: "https://superherocpr.com/reset?token=dev" });
  previews.push({ id: "password-reset", name: "Password Reset", subject: pw.subject, src: b64(pw.html) });

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
  });
  previews.push({ id: "booking-confirm", name: "Booking Confirmation", subject: booking.subject, src: b64(booking.html) });

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
