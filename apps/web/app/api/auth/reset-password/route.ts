/**
 * POST /api/auth/reset-password
 * Called by: /book/forgot-password (customer self-service)
 * Auth: None required — this is a public endpoint
 * Accepts an email address, generates a Supabase recovery link via the admin
 * client, and sends a branded reset email via Resend.
 *
 * Security notes:
 * - Always returns { success: true } regardless of whether the email exists.
 *   This prevents account enumeration — an attacker cannot determine which
 *   emails are registered by observing different responses.
 * - The recovery link is generated server-side (not exposed to the browser).
 * - The redirectTo in the link sends the user to /book/reset-password so they
 *   land in our custom reset flow rather than Supabase's default one.
 * - Basic email format validation rejects obviously malformed inputs early.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { selfServicePasswordResetEmail } from "@/lib/emails";

/** Minimal email format check — belt-and-suspenders against obviously bad input. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Handles a self-service password reset request.
 * Generates a recovery link and sends the branded reset email.
 * Always returns success to prevent account enumeration.
 * @param request - POST request with JSON body: { email: string }
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);

  if (!body || typeof body.email !== "string") {
    return Response.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    // Return success to avoid leaking which emails are valid
    return Response.json({ success: true });
  }

  // RESEND_API_KEY is required to send a branded email. If it is absent
  // (e.g. local dev without Resend configured), fall back silently to
  // Supabase's default email so the reset flow still works in development.
  if (!process.env.RESEND_API_KEY) {
    const supabase = await createAdminClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/book/reset-password`,
    }).catch(() => {/* non-fatal — always return success */});
    return Response.json({ success: true });
  }

  const supabase = await createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  // Generate the recovery link via the admin API so we control the redirect
  // destination and can embed it in our own branded email.
  const { data: linkData, error: linkError } =
    await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        // After token exchange, Supabase appends the auth hash and redirects here
        redirectTo: `${siteUrl}/book/reset-password`,
      },
    });

  // If link generation fails (e.g. email not found), return success anyway
  // to avoid leaking whether the account exists.
  if (linkError || !linkData?.properties?.action_link) {
    return Response.json({ success: true });
  }

  // Send the branded email via Resend
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { subject, html } = selfServicePasswordResetEmail({
    actionLink: linkData.properties.action_link,
  });

  await resend.emails
    .send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: email,
      subject,
      html,
    })
    .catch((err: unknown) => {
      // Email failure is logged but not surfaced — response is always success
      console.error("[reset-password] Resend send failed (non-fatal):", err);
    });

  return Response.json({ success: true });
}
