/**
 * lib/emails.ts
 * Central repository for all transactional email content used by SuperHeroCPR.
 *
 * Every email sent by the system is defined here as a named function that
 * accepts the data it needs and returns { subject, html }. Route files are
 * responsible for fetching data, checking RESEND_API_KEY, and calling Resend.
 * This file has no knowledge of Resend, HTTP, or Supabase.
 *
 * To edit email copy: find the function by name, change the template string.
 * To add a new email: add a new exported function following the same pattern.
 *
 * All functions call wrapEmail() internally so output is always branded.
 * escapeHtml() is a private helper used only within this file to sanitize
 * user-supplied values before inserting them into HTML.
 */

import { wrapEmail } from "@/lib/email";

// ── Private helpers ────────────────────────────────────────────────────────────

/** Escapes HTML special characters to prevent injection in email bodies. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ── Return type shared by all email builders ───────────────────────────────────

export interface EmailContent {
  subject: string;
  html: string;
}

// ── 1. Welcome email (new account via public booking flow) ─────────────────────

/**
 * Sent to a newly created customer after they create an account in the booking flow.
 * Triggered by: POST /api/emails/welcome
 * @param firstName - The customer's first name.
 */
export function welcomeEmail({ firstName }: { firstName: string }): EmailContent {
  return {
    subject: "Welcome to SuperHeroCPR!",
    html: wrapEmail(`
      <h1>Welcome, ${firstName}!</h1>
      <p>Your SuperHeroCPR account has been created successfully.</p>
      <p>You can now book classes, view your certifications, and manage your account at
        <a href="https://superherocpr.com/dashboard">superherocpr.com</a>.
      </p>
      <p>See you in class!</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 2. Rollcall welcome email (new student checked in at class) ────────────────

/**
 * Sent to a new student after they create an account on the rollcall check-in page.
 * Triggered by: POST /api/rollcall/register
 * @param firstName - The student's first name.
 */
export function rollcallWelcomeEmail({ firstName }: { firstName: string }): EmailContent {
  return {
    subject: "Welcome to SuperHeroCPR!",
    html: wrapEmail(`
      <h1>Welcome, ${firstName}!</h1>
      <p>You've been checked in for today's class. Great to have you!</p>
      <p>Your SuperHeroCPR account is now active. You can view your certifications
      and booking history at
      <a href="https://superherocpr.com/dashboard">superherocpr.com/dashboard</a>.</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 3. Contact form — business notification ────────────────────────────────────

/**
 * Sent to info@superherocpr.com when a visitor submits the public contact form.
 * All user-supplied values are escaped before insertion.
 * Triggered by: POST /api/contact
 * @param name        - Submitter's full name.
 * @param email       - Submitter's email address.
 * @param phone       - Submitter's phone number (null if not provided).
 * @param inquiryType - Selected inquiry category.
 * @param message     - The message body.
 */
export function contactNotificationEmail({
  name,
  email,
  phone,
  inquiryType,
  message,
}: {
  name: string;
  email: string;
  phone: string | null;
  inquiryType: string;
  message: string;
}): EmailContent {
  const safeName        = escapeHtml(name.trim());
  const safeEmail       = escapeHtml(email.trim());
  const safePhone       = escapeHtml(phone ?? "Not provided");
  const safeInquiryType = escapeHtml(inquiryType.trim());
  // Preserve newlines as <br> tags for readability in the email client
  const safeMessage     = escapeHtml(message.trim()).replace(/\n/g, "<br>");

  return {
    subject: `New Contact Form Submission — ${inquiryType.trim()}`,
    html: wrapEmail(`
      <h2>New contact form submission</h2>
      <table>
        <tr><td><strong>Name:</strong></td><td>${safeName}</td></tr>
        <tr><td><strong>Email:</strong></td><td>${safeEmail}</td></tr>
        <tr><td><strong>Phone:</strong></td><td>${safePhone}</td></tr>
        <tr><td><strong>Inquiry type:</strong></td><td>${safeInquiryType}</td></tr>
      </table>
      <h3>Message:</h3>
      <p>${safeMessage}</p>
    `),
  };
}

// ── 4. Contact form — auto-reply to submitter ──────────────────────────────────

/**
 * Sent to the person who submitted the contact form to confirm receipt.
 * Triggered by: POST /api/contact
 * @param firstName - Submitter's first name (extracted from their full name).
 */
export function contactAutoReplyEmail({ firstName }: { firstName: string }): EmailContent {
  const safeFirstName = escapeHtml(firstName);

  return {
    subject: "We received your message — SuperHeroCPR",
    html: wrapEmail(`
      <h1>Thanks for reaching out, ${safeFirstName}!</h1>
      <p>We received your message and will get back to you within 1 business day.</p>
      <p>If your matter is urgent, you can also reach us at:</p>
      <ul>
        <li>Phone: <a href="tel:+18139663969">(813) 966-3969</a></li>
        <li>Email: <a href="mailto:info@superherocpr.com">info@superherocpr.com</a></li>
      </ul>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 5. Account deleted confirmation ───────────────────────────────────────────

/**
 * Sent to a customer after their account has been archived (deleted).
 * Triggered by: POST /api/account/archive
 * @param firstName - The customer's first name (from their profile).
 */
export function accountDeletedEmail({ firstName }: { firstName: string }): EmailContent {
  return {
    subject: "Your SuperHeroCPR account has been deleted",
    html: wrapEmail(`
      <h1>Account Deleted</h1>
      <p>Hi ${firstName},</p>
      <p>Your SuperHeroCPR account has been successfully deleted. You will no longer be able to log in.</p>
      <p>Your certification history has been preserved for our records.</p>
      <p>If you believe this was a mistake or wish to restore your account, please contact us at
        <a href="mailto:info@superherocpr.com">info@superherocpr.com</a> or call (813) 966-3969.
      </p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 6. Order shipped ───────────────────────────────────────────────────────────

/** A single line item in a shipped order email. */
export interface OrderEmailItem {
  productName: string;
  size: string;
  quantity: number;
  priceAtPurchase: number;
}

/**
 * Sent to a customer when an admin marks their merch order as shipped.
 * Builds the order summary table internally from the items array.
 * Triggered by: POST /api/orders/mark-shipped
 * @param firstName     - Customer's first name.
 * @param trackingNumber - Shipping tracking number.
 * @param carrier       - Carrier name (optional).
 * @param items         - Array of line items in the order.
 * @param totalAmount   - Order total in dollars.
 * @param shippingName  - Recipient name on the shipping address.
 * @param shippingCity  - Shipping city.
 * @param shippingState - Shipping state.
 */
export function orderShippedEmail({
  firstName,
  trackingNumber,
  carrier,
  items,
  totalAmount,
  shippingName,
  shippingCity,
  shippingState,
}: {
  firstName: string;
  trackingNumber: string;
  carrier: string | null;
  items: OrderEmailItem[];
  totalAmount: number;
  shippingName: string;
  shippingCity: string;
  shippingState: string;
}): EmailContent {
  const carrierLine = carrier
    ? `<p><strong>Carrier:</strong> ${carrier}</p>`
    : "";

  const itemsHtml = items
    .map(
      (item) => `<tr>
        <td style="padding:4px 8px">${item.productName}</td>
        <td style="padding:4px 8px">${item.size}</td>
        <td style="padding:4px 8px;text-align:center">${item.quantity}</td>
        <td style="padding:4px 8px;text-align:right">$${item.priceAtPurchase.toFixed(2)}</td>
      </tr>`
    )
    .join("");

  return {
    subject: "Your SuperHeroCPR order has shipped!",
    html: wrapEmail(`
      <h1>Your order is on the way, ${firstName}!</h1>
      <p>Your SuperHeroCPR order has shipped.</p>
      <p><strong>Tracking number:</strong> ${trackingNumber}</p>
      ${carrierLine}
      <h3>Your order:</h3>
      <table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:4px 8px;text-align:left">Product</th>
            <th style="padding:4px 8px;text-align:left">Size</th>
            <th style="padding:4px 8px;text-align:center">Qty</th>
            <th style="padding:4px 8px;text-align:right">Price</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="margin-top:12px"><strong>Order Total: $${totalAmount.toFixed(2)}</strong></p>
      <p>Shipping to: ${shippingName}, ${shippingCity}, ${shippingState}</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 7. Staff invite ────────────────────────────────────────────────────────────

/**
 * Sent to a newly invited staff member with their account setup link.
 * User-supplied values (firstName, personalMessage, roleLabel) are escaped.
 * Triggered by: POST /api/staff/invite
 * @param firstName       - Staff member's first name.
 * @param personalMessage - Optional personal message from the inviting admin.
 * @param roleLabel       - Human-readable role string (e.g. "Instructor").
 * @param actionLink      - Supabase-generated password setup link.
 * @param isInstructor    - Whether to show the payment account setup reminder.
 */
export function staffInviteEmail({
  firstName,
  personalMessage,
  roleLabel,
  actionLink,
  isInstructor,
}: {
  firstName: string;
  personalMessage: string | null;
  roleLabel: string;
  actionLink: string;
  isInstructor: boolean;
}): EmailContent {
  const safePersonalMessage = personalMessage?.trim()
    ? `<p>${escapeHtml(personalMessage.trim())}</p>`
    : "";

  const instructorNote = isInstructor
    ? `<p><strong>Important:</strong> Once you log in, you'll need to connect a payment account
       before you can send invoices. Visit Admin → Settings → Payment to get set up.</p>`
    : "";

  return {
    subject: "You've been invited to join SuperHeroCPR",
    html: wrapEmail(`
      <h1>Welcome to the SuperHeroCPR team, ${escapeHtml(firstName.trim())}!</h1>
      ${safePersonalMessage}
      <p>Your account has been created with the role of <strong>${escapeHtml(roleLabel)}</strong>.</p>
      <p>Click the link below to set your password and activate your account.</p>
      <p><a href="${actionLink}">Set My Password →</a></p>
      <p>This link expires in 24 hours.</p>
      ${instructorNote}
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 8. Customer setup email (created by admin) ─────────────────────────────────

/**
 * Sent to a new customer when an admin creates their account manually.
 * Triggered by: POST /api/customers/create
 * @param firstName - Customer's first name.
 * @param setupLink - Supabase-generated password setup link.
 */
export function customerSetupEmail({
  firstName,
  setupLink,
}: {
  firstName: string;
  setupLink: string;
}): EmailContent {
  return {
    subject: "Set up your SuperHeroCPR account",
    html: wrapEmail(`
      <h1>Welcome to SuperHeroCPR, ${firstName}!</h1>
      <p>An account has been created for you. Click the link below to set your password and activate your account.</p>
      <p><a href="${setupLink}">Set My Password →</a></p>
      <p>This link expires in 24 hours.</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 9. Password reset (sent by admin on behalf of customer) ───────────────────

/**
 * Sent to a customer when a staff member triggers a password reset for them.
 * Triggered by: POST /api/customers/[id]/send-password-reset
 * @param firstName  - Customer's first name.
 * @param actionLink - Supabase-generated password reset link.
 */
export function passwordResetEmail({
  firstName,
  actionLink,
}: {
  firstName: string;
  actionLink: string;
}): EmailContent {
  return {
    subject: "Reset your SuperHeroCPR password",
    html: wrapEmail(`
      <h1>Password Reset</h1>
      <p>Hi ${firstName},</p>
      <p>A staff member has sent you a password reset link. Click below to set a new password for your SuperHeroCPR account.</p>
      <p><a href="${actionLink}">Reset My Password →</a></p>
      <p>This link expires in 24 hours. If you did not expect this email, you can safely ignore it.</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 10. Certification expiry reminder ─────────────────────────────────────────

/**
 * Sent to a customer whose CPR certification is expiring within 90 days.
 * Triggered by: POST /api/certifications/send-reminders (batch)
 * @param firstName     - Customer's first name.
 * @param certName      - The name of the certification type (e.g. "BLS for Healthcare Providers").
 * @param daysRemaining - Number of days until the certification expires.
 */
export function certReminderEmail({
  firstName,
  certName,
  daysRemaining,
}: {
  firstName: string;
  certName: string;
  daysRemaining: number;
}): EmailContent {
  return {
    subject: "Your CPR Certification Expires Soon",
    html: wrapEmail(`
      <h1>Your certification is expiring soon, ${firstName}!</h1>
      <p>Your <strong>${certName}</strong> certification expires in
      <strong>${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}</strong>.</p>
      <p>Book a renewal class today to stay certified.</p>
      <a href="https://superherocpr.com/book">Book a Renewal Class →</a>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 11. Invoice paid — notification to instructor ─────────────────────────────

/**
 * Sent to the instructor when one of their invoices is marked as paid.
 * Triggered by: POST /api/invoices/mark-paid
 * @param firstName      - Instructor's first name.
 * @param invoiceNumber  - Invoice number (e.g. "INV-0042").
 * @param recipientName  - Name of the company or individual who was invoiced.
 * @param studentCount   - Number of student spots reserved.
 */
export function invoicePaidEmail({
  firstName,
  invoiceNumber,
  recipientName,
  studentCount,
}: {
  firstName: string;
  invoiceNumber: string;
  recipientName: string;
  studentCount: number;
}): EmailContent {
  return {
    subject: `Invoice ${invoiceNumber} marked as paid`,
    html: wrapEmail(`
      <p>Hi ${firstName},</p>
      <p>Invoice <strong>${invoiceNumber}</strong> for ${recipientName} has been marked as paid.</p>
      <p>${studentCount} student spot${studentCount !== 1 ? "s" : ""} have been reserved for the class.</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 12. Invoice resend ─────────────────────────────────────────────────────────

/**
 * Sent when an instructor or admin resends an existing invoice.
 * Formats the date and amount internally from raw values.
 * Triggered by: POST /api/invoices/resend
 * @param invoiceNumber   - Invoice number.
 * @param recipientName   - Name of the recipient.
 * @param className       - Name of the CPR class.
 * @param sessionDate     - ISO date string of the class session (null if unknown).
 * @param locationName    - Venue name.
 * @param locationCity    - Venue city.
 * @param locationState   - Venue state.
 * @param studentCount    - Number of students on the invoice.
 * @param totalAmount     - Invoice total in dollars (null if unavailable).
 * @param notes           - Optional notes on the invoice.
 * @param paymentPlatform - Payment platform name (e.g. "PayPal").
 */
export function invoiceResendEmail({
  invoiceNumber,
  recipientName,
  className,
  sessionDate,
  locationName,
  locationCity,
  locationState,
  studentCount,
  totalAmount,
  notes,
  paymentPlatform,
}: {
  invoiceNumber: string;
  recipientName: string;
  className: string;
  sessionDate: string | null;
  locationName: string;
  locationCity: string;
  locationState: string;
  studentCount: number;
  totalAmount: number | null;
  notes: string | null;
  paymentPlatform: string | null;
}): EmailContent {
  const formattedDate = sessionDate
    ? new Date(sessionDate).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "See your instructor for details";

  const formattedAmount =
    typeof totalAmount === "number"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalAmount)
      : "$0.00";

  return {
    subject: `Invoice ${invoiceNumber} from SuperHeroCPR`,
    html: wrapEmail(`
      <h1>Invoice ${invoiceNumber}</h1>
      <p>Hello ${recipientName},</p>
      <p>Please find your invoice for the upcoming CPR class below.</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px">
        <tr><td style="padding:8px;color:#555">Class</td><td style="padding:8px;font-weight:bold">${className}</td></tr>
        <tr><td style="padding:8px;color:#555">Date</td><td style="padding:8px">${formattedDate}</td></tr>
        <tr><td style="padding:8px;color:#555">Location</td><td style="padding:8px">${locationName}, ${locationCity}, ${locationState}</td></tr>
        <tr><td style="padding:8px;color:#555">Students</td><td style="padding:8px">${studentCount}</td></tr>
        <tr><td style="padding:8px;color:#555;font-weight:bold">Total Due</td><td style="padding:8px;font-weight:bold;font-size:18px">${formattedAmount}</td></tr>
      </table>
      ${notes ? `<p style="margin-top:16px;color:#555">Note: ${notes}</p>` : ""}
      <p style="margin-top:24px">Payment platform: ${paymentPlatform ?? "See your instructor"}</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 13. Invoice email (new invoice sent to recipient) ─────────────────────────

/**
 * Sent to the invoice recipient when a new invoice is created.
 * For group invoices, includes a "Submit Your Roster" button.
 * Builds the full email body internally including conditional rows.
 * Triggered by: POST /api/invoices/create (via sendInvoiceEmail helper)
 * @param invoiceNumber  - Invoice number.
 * @param recipientName  - Recipient's name.
 * @param invoiceType    - "individual" or "group".
 * @param companyName    - Company name (group invoices only, else null).
 * @param studentCount   - Number of students on the invoice.
 * @param totalAmount    - Invoice total in dollars.
 * @param className      - Name of the CPR class.
 * @param classDate      - ISO date string for the class.
 * @param locationName   - Venue name.
 * @param locationCity   - Venue city.
 * @param locationState  - Venue state.
 * @param notes          - Optional instructor notes.
 * @param paymentLink    - Direct payment URL (null if not provided).
 */
export function invoiceEmail({
  invoiceNumber,
  recipientName,
  invoiceType,
  companyName,
  studentCount,
  totalAmount,
  className,
  classDate,
  locationName,
  locationCity,
  locationState,
  notes,
  paymentLink,
}: {
  invoiceNumber: string;
  recipientName: string;
  invoiceType: "individual" | "group";
  companyName: string | null;
  studentCount: number;
  totalAmount: number;
  className: string;
  classDate: string;
  locationName: string;
  locationCity: string;
  locationState: string;
  notes: string | null;
  paymentLink: string | null;
}): EmailContent {
  const formattedDate = new Date(classDate).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(totalAmount);

  const companyRow = companyName
    ? `<tr>
        <td style="padding:6px 0;color:#6b7280;font-size:14px;">Company:</td>
        <td style="padding:6px 0;font-size:14px;">${companyName}</td>
       </tr>`
    : "";

  const notesRow = notes
    ? `<tr>
        <td style="padding:6px 0;color:#6b7280;font-size:14px;vertical-align:top;">Note:</td>
        <td style="padding:6px 0;font-size:14px;">${notes}</td>
       </tr>`
    : "";

  const paymentRow = paymentLink
    ? `<tr>
        <td style="padding:6px 0;color:#6b7280;font-size:14px;">Pay here:</td>
        <td style="padding:6px 0;font-size:14px;"><a href="${paymentLink}" style="color:#dc2626;">${paymentLink}</a></td>
       </tr>`
    : "";

  // Group invoices include a roster submission prompt so the company can
  // pre-register attendees and save time on class day.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://superherocpr.com";
  const rosterSection =
    invoiceType === "group"
      ? `<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
         <p style="font-size:14px;color:#374151;font-weight:600;">Submitting your student roster</p>
         <p style="font-size:14px;color:#6b7280;">
           If you have a list of staff attending this class, you can submit it in advance to save time on class day.
           This is only needed if you have multiple attendees and want to pre-register them.
         </p>
         <p style="font-size:14px;color:#6b7280;">Your invoice number: <strong>${invoiceNumber}</strong></p>
         <p>
           <a href="${baseUrl}/submit-roster?invoice=${invoiceNumber}"
              style="display:inline-block;background:#dc2626;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
             Submit Your Roster →
           </a>
         </p>
         <p style="font-size:12px;color:#9ca3af;">Note: Individual students do not need to submit a roster.</p>`
      : "";

  return {
    subject: `Invoice ${invoiceNumber} — ${className} on ${formattedDate}`,
    html: wrapEmail(`
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin-bottom:4px;">Invoice from SuperHeroCPR</h1>
      <p style="font-size:14px;color:#6b7280;margin-bottom:24px;">Invoice number: <strong>${invoiceNumber}</strong></p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">To:</td>
          <td style="padding:6px 0;font-size:14px;font-weight:600;">${recipientName}</td>
        </tr>
        ${companyRow}
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Class:</td>
          <td style="padding:6px 0;font-size:14px;">${className}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Date:</td>
          <td style="padding:6px 0;font-size:14px;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Location:</td>
          <td style="padding:6px 0;font-size:14px;">${locationName}, ${locationCity}, ${locationState}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Students:</td>
          <td style="padding:6px 0;font-size:14px;">${studentCount}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Amount:</td>
          <td style="padding:6px 0;font-size:16px;font-weight:700;color:#111827;">${formattedAmount}</td>
        </tr>
        ${notesRow}
        ${paymentRow}
      </table>

      ${rosterSection}

      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
      <p style="font-size:12px;color:#9ca3af;">
        This invoice was sent by a SuperHeroCPR instructor. For questions, reply to this email.
      </p>
    `),
  };
}
