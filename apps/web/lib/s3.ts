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
