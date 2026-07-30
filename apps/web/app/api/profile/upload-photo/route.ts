/**
 * POST /api/profile/upload-photo
 * Called by: BioSettingsSection when an instructor uploads their own headshot.
 * Auth: instructor, manager, or super_admin only.
 * Validates file type and size, compresses/resizes the image with sharp (max 800px,
 * JPEG quality 80), uploads to AWS S3 under the staff-photos/ prefix, and returns
 * the public URL. All S3 communication happens server-side — files are never sent
 * from the browser directly to S3.
 */

import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3BucketName, getS3Region } from "@/lib/s3";
import { requireApiRole } from "@/lib/auth/effective-role";
import type { UserRole } from "@/types/users";

export const runtime = "nodejs";

/** Roles permitted to upload their own profile photo. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "manager", "super_admin"];

/** Allowed MIME types for profile photos. */
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

/** Maximum dimension (width or height) in pixels after compression. */
const MAX_DIMENSION_PX = 800;

/** JPEG quality level used for all compressed outputs (0–100). */
const JPEG_QUALITY = 80;

/**
 * Sanitises a filename for use as an S3 object key.
 * Replaces characters that are not alphanumeric, dots, or hyphens with underscores.
 * @param filename - Raw filename from the uploaded file.
 * @returns Safe S3-compatible filename string.
 */
function sanitiseFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.\-]/g, "_");
}

/**
 * Compresses and resizes an image buffer to a web-safe JPEG.
 * Downscales to MAX_DIMENSION_PX on the longest edge (preserving aspect ratio),
 * strips EXIF metadata, and converts all input formats (including HEIC/HEIF) to JPEG.
 * @param buffer - Raw image bytes from the uploaded file.
 * @returns Compressed JPEG buffer.
 */
async function compressImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate() // auto-orient from EXIF before stripping metadata
    .resize(MAX_DIMENSION_PX, MAX_DIMENSION_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/**
 * Uploads the instructor's own headshot to S3.
 * Side effects: S3 object write under the staff-photos/ prefix.
 * @param request - Multipart form request containing the image file.
 */
export async function POST(request: Request): Promise<Response> {
  const authResult = await requireApiRole(ALLOWED_ROLES);
  if ("error" in authResult) return authResult.error;

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

  // Both helpers fall back to deployment defaults, so they always return values.
  const bucketName = getS3BucketName();
  const region = getS3Region();

  let url: string;
  try {
    const s3 = new S3Client({});
    const safeFilename = sanitiseFilename(file.name).replace(/\.[^.]+$/, ".jpg");
    // Timestamp prefix ensures unique S3 keys and prevents stale CDN caching
    const key = `staff-photos/${Date.now()}-${safeFilename}`;
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const buffer = await compressImage(rawBuffer);

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: "image/jpeg",
      })
    );

    url = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  } catch (err) {
    console.error("[profile/upload-photo] S3 upload failed:", err);
    return Response.json({ success: false, error: "Upload failed. Please try again." }, { status: 500 });
  }

  return Response.json({ success: true, url });
}
