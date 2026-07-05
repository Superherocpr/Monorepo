/**
 * POST /api/merch/upload-image
 * Called by: MerchAdminClient when a product image is selected.
 * Auth: super_admin only.
 * Validates file type and size, uploads to AWS S3, and returns the public URL.
 * Images are never uploaded directly from the browser — all S3 communication
 * happens server-side through this route.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { requireApiRole } from "@/lib/auth/effective-role";

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
 * Uploads a merch product image to S3 after confirming the caller is a super admin.
 * Side effects: S3 object write under the merch/ prefix.
 * @param request - Multipart form request containing the image file.
 */
export async function POST(request: Request) {
  // ── Auth guard ──────────────────────────────────────────────────────────────
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

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
    const region = process.env.AWS_REGION;
    if (!bucket || !region) {
      return Response.json(
        {
          success: false,
          error:
            "AWS S3 is not fully configured. Missing bucket or region.",
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

    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
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
