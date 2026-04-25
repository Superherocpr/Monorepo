/**
 * POST /api/emails/welcome
 * Called by: book/create-account page after account creation
 * Auth: None required — called server-side from the booking flow
 *
 * Sends a welcome email to a newly created customer via Resend.
 * Failure is non-fatal — the booking flow continues regardless.
 */

import { Resend } from "resend";

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

  if (!process.env.RESEND_API_KEY) {
    // Skip silently in environments without Resend configured
    return Response.json({ success: true, skipped: true });
  }

  // Instantiated inside the handler so it never executes at build time
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: "SuperHeroCPR <noreply@superherocpr.com>",
    to: email,
    subject: "Welcome to SuperHeroCPR!",
    html: `
      <h1>Welcome, ${firstName}!</h1>
      <p>Your SuperHeroCPR account has been created successfully.</p>
      <p>You can now book classes, view your certifications, and manage your account at
        <a href="https://superherocpr.com/dashboard">superherocpr.com</a>.
      </p>
      <p>See you in class!</p>
      <p>— The SuperHeroCPR Team</p>
    `,
  });

  return Response.json({ success: true });
}
