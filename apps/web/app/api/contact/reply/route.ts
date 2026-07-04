/**
 * POST /api/contact/reply
 * Called by: ContactSubmissionsClient — Send Reply form
 * Auth: manager and super_admin only
 * Accepts multipart/form-data with fields: submissionId, subject, body, and
 * zero or more file fields (each named "files"). For each file, the attachment
 * is first uploaded to Zoho Mail's attachment API to obtain an attachmentPath,
 * then the email is sent with those paths so files appear as native attachments
 * in the customer's mail client.
 * Side effects: Zoho Mail send, contact_replies insert, contact_submissions update.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { getZohoToken, getSetting } from "@/lib/zoho";

export const runtime = "nodejs";

/** Allowed MIME types for reply attachments. */
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);

/** Maximum size per attachment file (10 MB). */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Sanitises a filename by replacing characters that are not alphanumeric,
 * dots, or hyphens with underscores, preventing unusual S3 key names.
 * @param filename - Raw filename from the uploaded file.
 * @returns Safe S3-compatible filename string.
 */
function sanitiseFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.\-]/g, "_");
}

/**
 * Uploads a single file buffer to the Zoho Mail attachment staging endpoint
 * and returns the attachmentPath required for sending.
 * @param accountId - Zoho Mail account ID.
 * @param accessToken - Valid Zoho OAuth access token.
 * @param buffer - File contents as a Buffer.
 * @param filename - Original filename for the attachment.
 * @param contentType - MIME type of the file.
 * @returns The Zoho attachmentPath string.
 * @throws If the Zoho upload request fails.
 */
async function uploadToZoho(
  accountId: string,
  accessToken: string,
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const form = new FormData();
  form.append(
    "attach",
    new Blob([new Uint8Array(buffer)], { type: contentType }),
    filename
  );

  const res = await fetch(
    `https://mail.zoho.com/api/accounts/${accountId}/messages/attachments`,
    {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      body: form,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[contact/reply] Zoho attachment upload error:", text);
    throw new Error(`Zoho attachment upload failed (${res.status})`);
  }

  const json = (await res.json()) as { data?: { attachmentPath?: string } };
  const path = json.data?.attachmentPath;
  if (!path) throw new Error("Zoho did not return an attachmentPath.");
  return path;
}

/**
 * Uploads a file buffer to S3 for audit/record-keeping purposes.
 * Non-fatal — errors are logged but do not block the reply from sending.
 * @param submissionId - Used to namespace the S3 key.
 * @param buffer - File contents.
 * @param filename - Sanitised filename for the S3 key.
 * @param contentType - MIME type.
 */
async function uploadToS3ForRecord(
  submissionId: string,
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<void> {
  const bucket = process.env.S3_BUCKET_NAME;
  const region = process.env.AWS_REGION;
  if (!bucket || !region) return;

  const key = `contact-attachments/${submissionId}/${Date.now()}-${sanitiseFilename(filename)}`;
  const s3 = new S3Client({});
  try {
    await s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType })
    );
  } catch (err) {
    console.error("[contact/reply] S3 record upload failed (non-fatal):", err);
  }
}

/**
 * Processes a contact reply: validates files, uploads attachments to Zoho,
 * sends the email, and records the reply in the database.
 * @param request - Multipart form-data request.
 */
export async function POST(request: Request): Promise<Response> {
  // ── Auth & role check ──────────────────────────────────────────────────────
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;
  const user = actor.user;

  const adminClient = await createAdminClient();

  // ── Parse multipart form ───────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ success: false, error: "Invalid form data." }, { status: 400 });
  }

  const submissionId = formData.get("submissionId");
  const subject = formData.get("subject");
  const emailBody = formData.get("body");

  if (typeof submissionId !== "string" || !submissionId) {
    return Response.json({ success: false, error: "submissionId is required." }, { status: 400 });
  }
  if (typeof subject !== "string" || !subject.trim()) {
    return Response.json({ success: false, error: "Subject is required." }, { status: 400 });
  }
  if (typeof emailBody !== "string" || !emailBody.trim()) {
    return Response.json({ success: false, error: "Message body is required." }, { status: 400 });
  }

  const rawFiles = formData.getAll("files");
  const files = rawFiles.filter((f): f is File => f instanceof File && f.size > 0);

  // ── Validate each attachment ───────────────────────────────────────────────
  for (const file of files) {
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
      return Response.json(
        { success: false, error: `File "${file.name}" has an unsupported type. Use PDF, DOC, DOCX, JPG, or PNG.` },
        { status: 400 }
      );
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return Response.json(
        { success: false, error: `File "${file.name}" exceeds the 10 MB limit.` },
        { status: 400 }
      );
    }
  }

  // ── Fetch submission ───────────────────────────────────────────────────────
  const { data: submission } = await adminClient
    .from("contact_submissions")
    .select("id, email, name")
    .eq("id", submissionId)
    .single();

  if (!submission) {
    return Response.json({ success: false, error: "Submission not found." }, { status: 404 });
  }

  // ── Get Zoho credentials ──────────────────────────────────────────────────
  let accessToken: string;
  try {
    accessToken = await getZohoToken();
  } catch (err) {
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : "Zoho not connected." },
      { status: 503 }
    );
  }

  const accountId = await getSetting("zoho_account_id");
  if (!accountId) {
    return Response.json({ success: false, error: "Zoho account ID not configured." }, { status: 503 });
  }

  // ── Upload attachments to Zoho ─────────────────────────────────────────────
  interface ZohoAttachment {
    attachmentPath: string;
    attachmentName: string;
  }
  const zohoAttachments: ZohoAttachment[] = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());

    let attachmentPath: string;
    try {
      attachmentPath = await uploadToZoho(accountId, accessToken, buffer, file.name, file.type);
    } catch (err) {
      console.error("[contact/reply] Could not upload attachment to Zoho:", err);
      return Response.json(
        { success: false, error: `Failed to upload attachment "${file.name}". Please try again.` },
        { status: 502 }
      );
    }

    zohoAttachments.push({ attachmentPath, attachmentName: file.name });

    // Fire-and-forget S3 backup — errors are caught inside the helper
    void uploadToS3ForRecord(submissionId, buffer, file.name, file.type);
  }

  // ── Send email via Zoho Mail API ───────────────────────────────────────────
  const zohoPayload: Record<string, unknown> = {
    fromAddress: "contact@superherocpr.com",
    toAddress: submission.email,
    subject: subject.trim(),
    content: emailBody.trim(),
    mailFormat: "plaintext",
  };

  if (zohoAttachments.length > 0) {
    zohoPayload.attachments = zohoAttachments;
  }

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

  const zohoData = (await zohoRes.json()) as { data?: { messageId?: string } };
  const zohoMessageId = zohoData.data?.messageId ?? null;

  // ── Store reply in contact_replies ─────────────────────────────────────────
  const { error: replyInsertError } = await adminClient
    .from("contact_replies")
    .insert({
      submission_id: submissionId,
      sent_by: user.id,
      subject: subject.trim(),
      body: emailBody.trim(),
      zoho_message_id: zohoMessageId,
      has_attachments: zohoAttachments.length > 0,
    });

  if (replyInsertError) {
    // Email was sent — do not fail the request, but log the DB error
    console.error("[contact/reply] Failed to store reply record:", replyInsertError);
  }

  // ── Mark submission as replied ─────────────────────────────────────────────
  await adminClient
    .from("contact_submissions")
    .update({ replied: true })
    .eq("id", submissionId);

  return Response.json({ success: true });
}
