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
 * Initialises an S3 client.
 * Credentials and region are resolved automatically by the AWS SDK credential
 * provider chain — uses the Lambda execution role on Amplify, or
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION from .env.local locally.
 */
function getS3Client(): S3Client {
  return new S3Client({});
}

/**
 * Returns the configured S3 bucket name from S3_BUCKET_NAME.
 */
function getBucketName(): string | null {
  return process.env.S3_BUCKET_NAME ?? null;
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
 * Verifies file content matches the claimed type via magic bytes (THREAT-012).
 * Prevents an attacker from disguising arbitrary binaries (executables, scripts)
 * behind a .csv/.xlsx extension. Reads the first 1KB only.
 * @returns true when content is consistent with the file extension; false otherwise.
 */
async function verifyMagicBytes(file: File): Promise<boolean> {
  const name = file.name.toLowerCase();
  // Read enough bytes for header detection AND for CSV ASCII sampling.
  const sampleSize = Math.min(file.size, 1024);
  const head = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer());

  // XLSX = ZIP archive — header "PK\x03\x04"
  if (name.endsWith(".xlsx")) {
    return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  }

  // XLS = OLE compound document — header "D0 CF 11 E0 A1 B1 1A E1"
  if (name.endsWith(".xls")) {
    return (
      head[0] === 0xd0 &&
      head[1] === 0xcf &&
      head[2] === 0x11 &&
      head[3] === 0xe0 &&
      head[4] === 0xa1 &&
      head[5] === 0xb1 &&
      head[6] === 0x1a &&
      head[7] === 0xe1
    );
  }

  // CSV — accept anything that is text (no NUL bytes, no non-text control chars
  // besides tab/CR/LF) within the first 1KB. Strip BOM bytes if present.
  if (name.endsWith(".csv")) {
    let start = 0;
    // UTF-8 BOM
    if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) start = 3;
    for (let i = start; i < head.length; i++) {
      const b = head[i];
      if (b === 0) return false; // NUL byte → binary
      // Allow common ASCII text (0x09 tab, 0x0a LF, 0x0d CR, 0x20-0x7e printable)
      // and any high-bit byte (assume UTF-8 multibyte).
      if (
        b !== 0x09 &&
        b !== 0x0a &&
        b !== 0x0d &&
        (b < 0x20 || b > 0x7e) &&
        b < 0x80
      ) {
        return false;
      }
    }
    return true;
  }

  return false;
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

  // ── Validate file content via magic bytes (THREAT-012) ────────────────────
  // Prevents disguised executables/binaries from being uploaded under .csv/.xlsx.
  if (!(await verifyMagicBytes(file))) {
    return Response.json(
      {
        success: false,
        error: "File content does not match the file type. Please upload a real CSV or Excel file.",
      },
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
          from: process.env.RESEND_FROM_EMAIL!,
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
        from: process.env.RESEND_FROM_EMAIL!,
        to: "contact@superherocpr.com",
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
