/**
 * POST /api/roster-upload/submit
 * Called by: SubmitRosterClient Step 3 ("Submit Roster" button)
 * Auth: None — public. The invoiceId from the prior lookup step is re-verified server-side.
 * Validates the uploaded file, stores it in S3 under rosters/<invoiceId>/,
 * inserts a roster_uploads record in Supabase, and sends notification emails.
 * Side effects: S3 write, Supabase insert, Resend email (confirmation + manager notification).
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";

export const runtime = "nodejs";

/** Allowed MIME types for roster spreadsheets. */
const ALLOWED_TYPES = [
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

/** Maximum file size in bytes (10MB). */
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Sanitises a filename by replacing any character that is not alphanumeric,
 * a dot, or a hyphen with an underscore. Prevents unusual S3 key names.
 * @param filename - Raw filename from the uploaded file.
 * @returns Safe S3-compatible filename string.
 */
function sanitiseFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.\-]/g, "_");
}

/**
 * Initialises an S3 client from environment variables.
 */
function getS3Client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

/**
 * Returns the configured S3 bucket name.
 * Supports both AWS_S3_BUCKET_NAME (preferred) and AWS_S3_BUCKET (legacy).
 */
function getBucketName(): string | null {
  return process.env.AWS_S3_BUCKET_NAME ?? process.env.AWS_S3_BUCKET ?? null;
}

/**
 * Returns true if the file's MIME type or extension matches an accepted roster format.
 * Extension check is used as a fallback because some browsers report CSV as text/plain.
 * @param file - The uploaded File object.
 */
function isAcceptedFileType(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    ALLOWED_TYPES.includes(file.type as AllowedType) ||
    name.endsWith(".csv") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls")
  );
}

/**
 * Receives a roster spreadsheet, validates it, uploads it to S3, records the
 * submission in the database, and sends confirmation + manager notification emails.
 * @param request - Multipart form data with file, invoiceId, sessionId, and optional submitter info.
 */
export async function POST(request: Request) {
  // ── Parse form data ────────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ success: false, error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  const invoiceId = formData.get("invoiceId") as string | null;
  const sessionId = formData.get("sessionId") as string | null;
  const invoiceNumber = formData.get("invoiceNumber") as string | null;
  const submittedByName = formData.get("submittedByName") as string | null;
  const submittedByEmail = formData.get("submittedByEmail") as string | null;

  if (!(file instanceof File) || !invoiceId || !sessionId) {
    return Response.json(
      { success: false, error: "Missing required fields." },
      { status: 400 }
    );
  }

  // ── Re-verify the invoice server-side ─────────────────────────────────────
  // The invoiceId comes from the client — re-check it's a valid, non-cancelled
  // group invoice and that the sessionId matches what's on record.
  const supabase = await createAdminClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, invoice_type, status, class_session_id")
    .eq("id", invoiceId)
    .maybeSingle();

  if (
    !invoice ||
    invoice.invoice_type !== "group" ||
    invoice.status === "cancelled" ||
    invoice.class_session_id !== sessionId
  ) {
    return Response.json(
      { success: false, error: "Invalid invoice. Please start over." },
      { status: 400 }
    );
  }

  // ── Validate file type ─────────────────────────────────────────────────────
  if (!isAcceptedFileType(file)) {
    return Response.json(
      {
        success: false,
        error: "Invalid file type. Please upload a CSV or Excel file (.csv, .xlsx, .xls).",
      },
      { status: 400 }
    );
  }

  // ── Validate file size ─────────────────────────────────────────────────────
  if (file.size > MAX_SIZE_BYTES) {
    return Response.json(
      { success: false, error: "File too large. Maximum size is 10MB." },
      { status: 400 }
    );
  }

  // ── Upload to S3 ───────────────────────────────────────────────────────────
  const bucket = getBucketName();
  if (
    !bucket ||
    !process.env.AWS_REGION ||
    !process.env.AWS_ACCESS_KEY_ID ||
    !process.env.AWS_SECRET_ACCESS_KEY
  ) {
    return Response.json(
      { success: false, error: "File storage is not configured. Please contact support." },
      { status: 500 }
    );
  }

  let s3Url: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = sanitiseFilename(file.name);
    // Group by invoiceId so all roster submissions for the same class are together
    const key = `rosters/${invoiceId}/${Date.now()}-${safeName}`;

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: file.type,
        // No public-read ACL — roster files contain PII (employee names, emails)
        // and must not be publicly accessible. Managers access files via the admin
        // panel. TODO: serve via presigned URLs when the admin download feature is built.
      })
    );

    s3Url = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  } catch (err) {
    console.error("[roster-upload/submit] S3 upload failed:", err);
    return Response.json(
      { success: false, error: "File upload failed. Please try again." },
      { status: 500 }
    );
  }

  // ── Insert roster_upload record ────────────────────────────────────────────
  // Multiple submissions for the same invoice are allowed — the manager always
  // imports from the most recent unimported upload via the session detail page.
  const { error: dbError } = await supabase.from("roster_uploads").insert({
    invoice_id: invoiceId,
    session_id: sessionId,
    file_url: s3Url,
    original_filename: file.name,
    submitted_by_name: submittedByName || null,
    submitted_by_email: submittedByEmail || null,
    imported: false,
  });

  if (dbError) {
    console.error("[roster-upload/submit] DB insert failed:", dbError);
    return Response.json(
      { success: false, error: "Failed to record your submission. Please try again." },
      { status: 500 }
    );
  }

  // ── Send emails ────────────────────────────────────────────────────────────
  // Both emails are best-effort — the submission is already saved even if they fail.
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const invoiceRef = invoiceNumber ?? invoiceId;

    // Confirmation email to the person who submitted
    if (submittedByEmail) {
      await resend.emails
        .send({
          from: "SuperHeroCPR <noreply@superherocpr.com>",
          to: submittedByEmail,
          subject: `Your roster for invoice ${invoiceRef} has been received`,
          html: `
            <h1>Roster received!</h1>
            <p>Hi ${submittedByName ?? "there"},</p>
            <p>We've received your staff roster for your upcoming CPR class.
               Our team will review it before class day.</p>
            <p>If you need to make changes, simply resubmit the updated file at
               <a href="https://superherocpr.com/submit-roster">superherocpr.com/submit-roster</a>
               using the same invoice number.</p>
            <p>Invoice number: <strong>${invoiceRef}</strong></p>
            <p>— The SuperHeroCPR Team</p>
          `,
        })
        .catch((err: unknown) => {
          console.error("[roster-upload/submit] Submitter confirmation email failed (non-fatal):", err);
        });
    }

    // Manager notification so staff know a new roster is ready to import
    await resend.emails
      .send({
        from: "SuperHeroCPR <noreply@superherocpr.com>",
        to: "info@superherocpr.com",
        subject: `Roster submitted — Invoice ${invoiceRef}`,
        html: `
          <p>A customer has submitted a roster.</p>
          <p><strong>Invoice:</strong> ${invoiceRef}</p>
          <p><strong>File:</strong> ${file.name}</p>
          <p><strong>Submitted by:</strong> ${submittedByName ?? "Unknown"} (${submittedByEmail ?? "no email provided"})</p>
          <p>Import the roster from the session detail page in the admin panel.</p>
        `,
      })
      .catch((err: unknown) => {
        console.error("[roster-upload/submit] Manager notification email failed (non-fatal):", err);
      });
  }

  return Response.json({ success: true });
}
