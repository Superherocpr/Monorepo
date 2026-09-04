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
import { sendEmails } from "@/lib/send-email";
import { BUSINESS_CONTACT_EMAIL } from "@/lib/contact-constants";
import { contactNotificationEmail, contactAutoReplyEmail } from "@/lib/emails";
import { createClient } from "@/lib/supabase/server";
import { verifyTurnstileToken, getClientIp } from "@/lib/turnstile";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { name, email, phone, inquiryType, message, captchaToken } = body as Record<
    string,
    unknown
  >;

  // Verify Cloudflare Turnstile token BEFORE doing any work. The widget on
  // the contact forms produces this token; without a valid one we treat the
  // request as bot traffic. When TURNSTILE_SECRET_KEY is unset the helper
  // no-ops (returns success) so local dev without a key still works.
  const captcha = await verifyTurnstileToken(
    typeof captchaToken === "string" ? captchaToken : null,
    getClientIp(request)
  );
  if (!captcha.success) {
    return NextResponse.json(
      { success: false, error: captcha.error ?? "Captcha verification failed" },
      { status: 400 }
    );
  }

  // Validate required fields
  if (
    typeof name !== "string" || !name.trim() ||
    typeof email !== "string" || !email.trim() ||
    typeof phone !== "string" || !phone.trim() ||
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

  const phoneValue = (phone as string).trim();

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

  // ── 2. Send emails ───────────────────────────────────────────────────────────
  // Best-effort: the submission is already stored in the DB, so the message is
  // never lost even when both sends fail. sendEmail logs each failure itself.
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

  await sendEmails([
    // Notification to the business, with replies routed straight to the visitor
    // so staff can answer without copying the address out of the body.
    {
      context: "contact:business",
      to: BUSINESS_CONTACT_EMAIL,
      replyTo: email.trim(),
      subject: businessEmail.subject,
      html: businessEmail.html,
    },
    // Auto-reply to the visitor
    {
      context: "contact:auto-reply",
      to: email.trim(),
      subject: autoReply.subject,
      html: autoReply.html,
    },
  ]);

  return NextResponse.json({ success: true });
}
