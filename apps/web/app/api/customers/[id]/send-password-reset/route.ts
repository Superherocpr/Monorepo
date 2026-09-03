/**
 * POST /api/customers/[id]/send-password-reset
 * Called by: CustomerDetailClient — "Send Password Reset Email" button
 * Auth: Manager and super_admin only
 * Generates a Supabase password recovery link and sends it to the customer's
 * email via Resend. Staff cannot set the password directly — the customer
 * must use the link to set their own password.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { sendEmail } from "@/lib/send-email";
import { passwordResetEmail } from "@/lib/emails";

/**
 * Sends a password reset email to the specified customer.
 * @param request - POST request (no body required).
 * @param params - Route params containing the customer ID.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  void request; // No body needed — customer ID comes from URL
  const { id: customerId } = await params;
  const supabase = await createAdminClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  // ── Fetch customer email ───────────────────────────────────────────────────
  const { data: customer } = await supabase
    .from("profiles")
    .select("email, first_name")
    .eq("id", customerId)
    .eq("role", "customer")
    .single();

  if (!customer) {
    return Response.json({ success: false, error: "Customer not found." }, { status: 404 });
  }

  // ── Generate recovery link ─────────────────────────────────────────────────
  const { data: linkData, error: linkError } =
    await supabase.auth.admin.generateLink({
      type: "recovery",
      email: customer.email,
    });

  if (linkError || !linkData?.properties?.action_link) {
    return Response.json(
      { success: false, error: "Failed to generate reset link." },
      { status: 500 }
    );
  }

  // ── Send email ─────────────────────────────────────────────────────────────
  // Sending IS this route's purpose, so a failure is fatal and surfaces to the
  // staff member who clicked, rather than being swallowed as best-effort.
  const { subject, html } = passwordResetEmail({
    firstName: customer.first_name,
    actionLink: linkData.properties.action_link,
  });

  const result = await sendEmail({
    context: "customers/send-password-reset",
    to: customer.email,
    subject,
    html,
  });

  if (!result.sent) {
    return Response.json(
      {
        success: false,
        error:
          result.reason === "not_configured"
            ? "Email service is not configured."
            : "Failed to send reset email. Please try again.",
      },
      { status: 500 }
    );
  }

  return Response.json({ success: true, email: customer.email });
}
