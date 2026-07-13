/**
 * Shared AWS S3 configuration helpers.
 * Centralizes how every S3 route resolves the region used to build public
 * object URLs, so the resolution logic lives in exactly one place.
 */

/**
 * The region where all project S3 buckets (superherocpr-assets,
 * superherocpr-assets-staging, superherocpr-assets-prod) and the Amplify app
 * live. Used as the final fallback — see getS3Region for why.
 */
const DEFAULT_S3_REGION = "us-east-2";

/**
 * Resolves the AWS region for constructing public S3 object URLs.
 *
 * Order: AWS_REGION (present locally via .env.local and in most Lambda runtimes)
 * → AWS_S3_REGION (forwardable via the amplify.yml env grep) → the deployment
 * default. The fallback is required because AWS Amplify's SSR compute does NOT
 * expose AWS_REGION to the Next.js process, and the amplify.yml env grep does not
 * forward it — without a fallback, deployed S3 uploads fail the
 * "bucket or region is not configured" guard and return "Storage is not configured".
 *
 * @returns A non-empty AWS region string.
 */
export function getS3Region(): string {
  return process.env.AWS_REGION ?? process.env.AWS_S3_REGION ?? DEFAULT_S3_REGION;
}

/**
 * The production assets bucket. Used as the fallback when S3_BUCKET_NAME is not
 * delivered to the runtime. Matches the app-level Amplify env var value, which
 * applies to all deployed branches; local dev overrides via .env.local.
 * Bucket names are not secrets — they appear in every public image URL.
 */
const DEFAULT_S3_BUCKET = "superherocpr-assets-prod";

/**
 * Resolves the S3 bucket name for uploads and public object URLs.
 *
 * Prefers the S3_BUCKET_NAME env var (set in .env.local for dev, and forwarded
 * to .env.production by the amplify.yml env grep when Amplify delivers it to the
 * build). Falls back to the production bucket because Amplify's env var delivery
 * to the main branch build has been observed to silently drop vars (verified
 * 2026-07-13: branch-level S3_BUCKET_NAME set before a rebuild still did not
 * appear in the build environment), which caused deployed uploads to fail with
 * "Storage is not configured".
 *
 * @returns A non-empty S3 bucket name.
 */
export function getS3BucketName(): string {
  return process.env.S3_BUCKET_NAME ?? DEFAULT_S3_BUCKET;
}
