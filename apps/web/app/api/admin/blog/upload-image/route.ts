/**
 * POST /api/admin/blog/upload-image
 * Called by: BlogEditorClient when a cover image or inline image is selected.
 * Auth: super_admin only.
 * Validates file type and size, uploads to S3 under the blog/ prefix, returns the public URL.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3BucketName, getS3Region } from "@/lib/s3";
import { requireApiRole } from "@/lib/auth/effective-role";

export const runtime = "nodejs";

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Sanitises a filename for use as an S3 key segment.
 * @param filename - Raw filename from the uploaded File object.
 * @returns Filename with any non-safe characters replaced by underscores.
 */
function sanitiseFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.\-]/g, "_");
}

/** Initialises an S3 client using the SDK credential provider chain. */
function getS3Client(): S3Client {
  return new S3Client({});
}

/**
 * Uploads a blog image to S3 under the blog/ prefix.
 * Side effects: S3 object write under blog/ prefix.
 * @param request - Multipart form request containing the image file.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

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

  if (!ALLOWED_TYPES.includes(file.type as AllowedType)) {
    return Response.json(
      { success: false, error: "Invalid file type. Use JPG, PNG, or WEBP." },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return Response.json(
      { success: false, error: "File too large. Maximum size is 5 MB." },
      { status: 400 }
    );
  }

  try {
    const bucket = getS3BucketName();
    const region = getS3Region();
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = sanitiseFilename(file.name);
    const key = `blog/${Date.now()}-${safeName}`;

    const s3 = getS3Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: file.type,
        // Public read is granted via the bucket policy on the blog/* prefix.
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
