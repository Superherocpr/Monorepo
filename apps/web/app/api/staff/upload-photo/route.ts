/**
 * POST /api/staff/upload-photo
 * Called by: BioEditPanel when an admin uploads a staff headshot.
 * Auth: super_admin only.
 * Validates file type and size, uploads to AWS S3 under the staff-photos/ prefix,
 * and returns the public URL. All S3 communication happens server-side — files are
 * never sent from the browser directly to S3.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Allowed MIME types for staff photos. */
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

/** Maximum file size in bytes (5 MB). */
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Sanitises a filename by replacing characters that are not alphanumeric,
 * dots, or hyphens with underscores. Prevents path traversal or unusual S3 key names.
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
 * Supports AWS_S3_BUCKET_NAME (preferred) and AWS_S3_BUCKET (legacy).
 */
function getBucketName(): string | null {
  return process.env.AWS_S3_BUCKET_NAME ?? process.env.AWS_S3_BUCKET ?? null;
}

export async function POST(request: Request) {
  // ── Auth guard ──────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "super_admin") {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Parse multipart form ────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ success: false, error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ success: false, error: "No file provided" }, { status: 400 });
  }

  // ── Validate type ───────────────────────────────────────────────────────────
  if (!ALLOWED_TYPES.includes(file.type as AllowedType)) {
    return Response.json(
      { success: false, error: "Invalid file type. Use JPG, PNG, or WEBP." },
      { status: 400 }
    );
  }

  // ── Validate size ───────────────────────────────────────────────────────────
  if (file.size > MAX_SIZE_BYTES) {
    return Response.json(
      { success: false, error: "File too large. Maximum size is 5 MB." },
      { status: 400 }
    );
  }

  // ── Upload to S3 ────────────────────────────────────────────────────────────
  const bucketName = getBucketName();
  if (!bucketName) {
    console.error("[staff/upload-photo] AWS_S3_BUCKET_NAME env var is not set.");
    return Response.json(
      { success: false, error: "Storage is not configured." },
      { status: 500 }
    );
  }

  const s3 = getS3Client();
  const safeFilename = sanitiseFilename(file.name);
  // Timestamp prefix ensures each upload gets a unique key — prevents stale CDN caching
  const key = `staff-photos/${Date.now()}-${safeFilename}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: file.type,
      })
    );
  } catch (err) {
    console.error("[staff/upload-photo] S3 upload failed:", err);
    return Response.json(
      { success: false, error: "Upload failed. Please try again." },
      { status: 500 }
    );
  }

  const region = process.env.AWS_REGION!;
  const url = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

  return Response.json({ success: true, url });
}
