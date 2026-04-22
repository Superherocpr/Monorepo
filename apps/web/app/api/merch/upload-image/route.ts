/**
 * POST /api/merch/upload-image
 * Called by: MerchAdminClient when a product image is selected.
 * Auth: super_admin only.
 * Validates file type and size, uploads to AWS S3, and returns the public URL.
 * Images are never uploaded directly from the browser — all S3 communication
 * happens server-side through this route.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Allowed MIME types for product images. */
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

/** Maximum file size in bytes (5MB). */
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Sanitises a filename by replacing any character that is not alphanumeric,
 * a dot, or a hyphen with an underscore. Prevents path traversal or
 * unusual key names in S3.
 * @param filename - Raw filename from the uploaded file.
 * @returns Safe S3-compatible filename string.
 */
function sanitiseFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.\-]/g, "_");
}

/**
 * Initialises an S3 client from environment variables.
 * Throws at build time if required vars are missing.
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

  // ── Validate type ──────────────────────────────────────────────────────────
  if (!ALLOWED_TYPES.includes(file.type as AllowedType)) {
    return Response.json(
      { success: false, error: "Invalid file type. Use JPG, PNG, or WEBP." },
      { status: 400 }
    );
  }

  // ── Validate size ──────────────────────────────────────────────────────────
  if (file.size > MAX_SIZE_BYTES) {
    return Response.json(
      { success: false, error: "File too large. Maximum size is 5MB." },
      { status: 400 }
    );
  }

  // ── Upload to S3 ──────────────────────────────────────────────────────────
  try {
    const bucket = getBucketName();
    if (
      !bucket ||
      !process.env.AWS_REGION ||
      !process.env.AWS_ACCESS_KEY_ID ||
      !process.env.AWS_SECRET_ACCESS_KEY
    ) {
      return Response.json(
        {
          success: false,
          error:
            "AWS S3 is not fully configured. Missing bucket, region, or credentials.",
        },
        { status: 500 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = sanitiseFilename(file.name);
    // Prefix with timestamp to avoid key collisions
    const key = `merch/${Date.now()}-${safeName}`;

    const s3 = getS3Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: file.type,
        // No ACL — bucket has Object Ownership set to "Bucket owner enforced" which
        // disables per-object ACLs. Public read is granted via the bucket policy on
        // the merch/* prefix instead.
      })
    );

    const url = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    return Response.json({ success: true, url });
  } catch (err) {
    console.error("[upload-image] S3 upload failed:", err);
    const detail = err instanceof Error ? err.message : "Unknown S3 error";
    return Response.json(
      {
        success: false,
        error: "Image upload failed. Please try again.",
        detail: process.env.NODE_ENV === "development" ? detail : undefined,
      },
      { status: 500 }
    );
  }
}
