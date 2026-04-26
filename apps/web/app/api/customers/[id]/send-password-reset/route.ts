/**
 * POST /api/customers/[id]/send-password-reset
 * Called by: CustomerDetailClient — "Send Password Reset Email" button
 * Auth: Manager and super_admin only
 * Generates a Supabase password recovery link and sends it to the customer's
 * email via Resend. Staff cannot set the password directly — the customer
 * must use the link to set their own password.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || (actor.role !== "manager" && actor.role !== "super_admin")) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

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

  // ── Send email via Resend ──────────────────────────────────────────────────
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, html } = passwordResetEmail({
      firstName: customer.first_name,
      actionLink: linkData.properties.action_link,
    });
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: customer.email,
      subject,
      html,
    });
  }

  return Response.json({ success: true, email: customer.email });
}
