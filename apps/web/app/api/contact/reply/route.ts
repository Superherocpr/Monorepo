/**
 * POST /api/contact/reply
 * Called by: SubmissionsClient — Send Reply form
 * Auth: manager and super_admin only
 * 1. Validates the submission exists.
 * 2. Sends the reply email via Zoho Mail API.
 * 3. Stores the reply in contact_replies.
 * 4. Marks the submission as replied.
 */

import { createClient } from "@/lib/supabase/server";
import { getZohoToken, getSetting } from "@/lib/zoho";

/**
 * Sends a staff reply to a contact submission via Zoho Mail.
 * @param request - POST body: { submissionId, subject, body, attachmentUrls? }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

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

  // ── Parse & validate body ──────────────────────────────────────────────────
  let body: {
    submissionId?: unknown;
    subject?: unknown;
    body?: unknown;
    attachmentUrls?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { submissionId, subject, body: emailBody, attachmentUrls } = body;

  if (typeof submissionId !== "string" || !submissionId) {
    return Response.json({ success: false, error: "submissionId is required." }, { status: 400 });
  }
  if (typeof subject !== "string" || !subject.trim()) {
    return Response.json({ success: false, error: "Subject is required." }, { status: 400 });
  }
  if (typeof emailBody !== "string" || !emailBody.trim()) {
    return Response.json({ success: false, error: "Message body is required." }, { status: 400 });
  }

  const urls: string[] = Array.isArray(attachmentUrls)
    ? (attachmentUrls as unknown[]).filter((u) => typeof u === "string") as string[]
    : [];

  // ── Fetch the submission to get the contact's email ───────────────────────
  const { data: submission } = await supabase
    .from("contact_submissions")
    .select("id, email, name")
    .eq("id", submissionId)
    .single();

  if (!submission) {
    return Response.json(
      { success: false, error: "Submission not found." },
      { status: 404 }
    );
  }

  // ── Get Zoho credentials ──────────────────────────────────────────────────
  let accessToken: string;
  try {
    accessToken = await getZohoToken();
  } catch (err) {
    return Response.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Zoho not connected.",
      },
      { status: 503 }
    );
  }

  const accountId = await getSetting("zoho_account_id");
  if (!accountId) {
    return Response.json(
      { success: false, error: "Zoho account ID not configured." },
      { status: 503 }
    );
  }

  // ── Send email via Zoho Mail API ───────────────────────────────────────────
  const zohoPayload = {
    fromAddress: "contact@superherocpr.com",
    toAddress: submission.email,
    subject: subject.trim(),
    content: emailBody.trim(),
    mailFormat: "plaintext",
  };

  const zohoRes = await fetch(
    `https://mail.zoho.com/api/accounts/${accountId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(zohoPayload),
    }
  );

  if (!zohoRes.ok) {
    const errText = await zohoRes.text().catch(() => "");
    console.error("[contact/reply] Zoho send error:", errText);
    return Response.json(
      { success: false, error: "Failed to send email via Zoho Mail." },
      { status: 502 }
    );
  }

  const zohoData = (await zohoRes.json()) as {
    data?: { messageId?: string };
    status?: { code: number };
  };

  const zohoMessageId = zohoData.data?.messageId ?? null;

  // ── Store reply in contact_replies ─────────────────────────────────────────
  const { error: replyInsertError } = await supabase
    .from("contact_replies")
    .insert({
      submission_id: submissionId,
      sent_by: user.id,
      subject: subject.trim(),
      body: emailBody.trim(),
      zoho_message_id: zohoMessageId,
      has_attachments: urls.length > 0,
    });

  if (replyInsertError) {
    // Email was sent — do not fail the request, but log the DB error
    console.error("[contact/reply] Failed to store reply record:", replyInsertError);
  }

  // ── Mark submission as replied ─────────────────────────────────────────────
  await supabase
    .from("contact_submissions")
    .update({ replied: true })
    .eq("id", submissionId);

  return Response.json({ success: true });
}
