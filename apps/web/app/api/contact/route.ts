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
import { contactNotificationEmail, contactAutoReplyEmail } from "@/lib/emails";
import { createClient } from "@/lib/supabase/server";

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

  const businessEmail = contactNotificationEmail({
    name: name.trim(),
    email: email.trim(),
    phone: phoneValue,
    inquiryType: inquiryType.trim(),
    message: message.trim(),
  });

  const autoReply = contactAutoReplyEmail({
    firstName: name.trim().split(" ")[0],
  });

  // Notification email to business — intentionally fire-and-forget; errors are logged
  const businessEmailPromise = resend.emails
    .send({
      from: "SuperHeroCPR Website <noreply@superherocpr.com>",
      to: "info@superherocpr.com",
      subject: businessEmail.subject,
      html: businessEmail.html,
    })
    .catch((err: unknown) =>
      console.error("[contact] Failed to send business notification email:", err)
    );

  // Auto-reply to submitter
  const autoReplyPromise = resend.emails
    .send({
      from: "SuperHeroCPR <noreply@superherocpr.com>",
      to: email.trim(),
      subject: autoReply.subject,
      html: autoReply.html,
    })
    .catch((err: unknown) =>
      console.error("[contact] Failed to send auto-reply email:", err)
    );

  await Promise.all([businessEmailPromise, autoReplyPromise]);

  return NextResponse.json({ success: true });
}
