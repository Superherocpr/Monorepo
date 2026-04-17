/**
 * POST /api/contact
 * Called by: ContactSection.tsx (public /contact page form)
 * Auth: None — public endpoint
 *
 * 1. Validates required fields.
 * 2. Inserts submission into contact_submissions table.
 * 3. Sends notification email to the business (if RESEND_API_KEY is set).
 * 4. Sends auto-reply confirmation to the submitter (if RESEND_API_KEY is set).
 */

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";

/** Escapes HTML special characters in a string to prevent injection into email HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { name, email, phone, inquiryType, message } = body as Record<
    string,
    unknown
  >;

  // Validate required fields
  if (
    typeof name !== "string" || !name.trim() ||
    typeof email !== "string" || !email.trim() ||
    typeof inquiryType !== "string" || !inquiryType.trim() ||
    typeof message !== "string" || !message.trim()
  ) {
    return NextResponse.json(
      { success: false, error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Basic email format check — the real guard is the browser's type="email"
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { success: false, error: "Invalid email address" },
      { status: 400 }
    );
  }

  const phoneValue =
    typeof phone === "string" && phone.trim() ? phone.trim() : null;

  // ── 1. Store in DB ──────────────────────────────────────────────────────────
  const supabase = await createClient();

  const { error: dbError } = await supabase.from("contact_submissions").insert({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phoneValue,
    inquiry_type: inquiryType.trim(),
    message: message.trim(),
  });

  if (dbError) {
    console.error("[contact] Failed to store submission:", dbError);
    return NextResponse.json(
      { success: false, error: "Failed to store submission" },
      { status: 500 }
    );
  }

  // ── 2. Send emails via Resend ────────────────────────────────────────────────
  // Emails are best-effort — if RESEND_API_KEY is missing, we log a warning and
  // skip the send rather than failing the request. The submission is already
  // stored in the DB, so the message is not lost.
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      "[contact] RESEND_API_KEY is not set — skipping email notifications"
    );
    return NextResponse.json({ success: true });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  // Escape all user-supplied values before inserting into HTML
  const safeName = escapeHtml(name.trim());
  const safeEmail = escapeHtml(email.trim());
  const safePhone = escapeHtml(phoneValue ?? "Not provided");
  const safeInquiryType = escapeHtml(inquiryType.trim());
  const safeMessage = escapeHtml(message.trim()).replace(/\n/g, "<br>");
  const safeFirstName = escapeHtml(name.trim().split(" ")[0]);

  // Notification email to business — intentionally fire-and-forget; errors are logged
  const businessEmailPromise = resend.emails
    .send({
      from: "Superhero CPR Website <noreply@superherocpr.com>",
      to: "info@superherocpr.com",
      subject: `New Contact Form Submission — ${inquiryType.trim()}`,
      html: `
        <h2>New contact form submission</h2>
        <table>
          <tr><td><strong>Name:</strong></td><td>${safeName}</td></tr>
          <tr><td><strong>Email:</strong></td><td>${safeEmail}</td></tr>
          <tr><td><strong>Phone:</strong></td><td>${safePhone}</td></tr>
          <tr><td><strong>Inquiry type:</strong></td><td>${safeInquiryType}</td></tr>
        </table>
        <h3>Message:</h3>
        <p>${safeMessage}</p>
      `,
    })
    .catch((err: unknown) =>
      console.error("[contact] Failed to send business notification email:", err)
    );

  // Auto-reply to submitter
  const autoReplyPromise = resend.emails
    .send({
      from: "Superhero CPR <noreply@superherocpr.com>",
      to: email.trim(),
      subject: "We received your message — Superhero CPR",
      html: `
        <h1>Thanks for reaching out, ${safeFirstName}!</h1>
        <p>We received your message and will get back to you within 1 business day.</p>
        <p>If your matter is urgent, you can also reach us at:</p>
        <ul>
          <li>Phone: <a href="tel:+18139663969">(813) 966-3969</a></li>
          <li>Email: <a href="mailto:info@superherocpr.com">info@superherocpr.com</a></li>
        </ul>
        <p>— The Superhero CPR Team</p>
      `,
    })
    .catch((err: unknown) =>
      console.error("[contact] Failed to send auto-reply email:", err)
    );

  await Promise.all([businessEmailPromise, autoReplyPromise]);

  return NextResponse.json({ success: true });
}
