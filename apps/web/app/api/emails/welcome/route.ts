/**
 * POST /api/emails/welcome
 * Called by: book/create-account page after account creation
 * Auth: None required — called server-side from the booking flow
 *
 * Sends a welcome email to a newly created customer via Resend.
 * Failure is non-fatal — the booking flow continues regardless.
 */

import { sendEmail } from "@/lib/send-email";
import { welcomeEmail } from "@/lib/emails";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const { firstName, email } = body;

  if (typeof firstName !== "string" || typeof email !== "string") {
    return Response.json({ success: false, error: "Missing required fields" }, { status: 400 });
  }

  const { subject, html } = welcomeEmail({ firstName });

  // Best-effort: the caller is mid-booking and must not be blocked by a mail
  // failure. The outcome is still reported so the booking flow — and the server
  // log — can tell a delivered welcome from a dropped one.
  const result = await sendEmail({
    context: "emails/welcome",
    to: email,
    subject,
    html,
  });

  return Response.json({
    success: true,
    emailSent: result.sent,
    ...(result.sent ? {} : { skipped: result.reason === "not_configured" }),
  });
}
