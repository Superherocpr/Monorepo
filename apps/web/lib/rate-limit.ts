/**
 * In-process, per-key rate limiting for public (unauthenticated) endpoints.
 *
 * Used by: /api/rollcall/verify-code (brute-force deterrent on the 6-digit
 * access code) and /api/bookings/check-existing-customer (stops the booking
 * page's account lookup being used to enumerate customers).
 *
 * The buckets live in module memory, so each serverless instance keeps its own
 * count and the effective limit is `max` x instanceCount. That is acceptable
 * for a deterrent; it is not a hard guarantee. A shared store (database or
 * edge) would be needed for that.
 */

/** Settings for one limiter. */
export interface RateLimiterOptions {
  /** Maximum requests allowed per key within one window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Bucket count above which expired buckets are swept, bounding memory growth. */
const SWEEP_THRESHOLD = 10_000;

/**
 * Creates an independent limiter with its own buckets.
 * @param options - Maximum requests per key and the window length.
 * @returns A function that records one request for a key and returns true
 *   while the key is within its limit, false once it has exceeded it. Calling
 *   it counts the request even when it is refused, so a client that keeps
 *   hammering stays blocked until its window expires.
 */
export function createRateLimiter(options: RateLimiterOptions): (key: string) => boolean {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (key: string): boolean => {
    const now = Date.now();

    // Sweep expired buckets only when the map is large, so the common path
    // stays O(1) but an attacker rotating keys cannot grow memory forever.
    if (buckets.size > SWEEP_THRESHOLD) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt < now) buckets.delete(bucketKey);
      }
    }

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= options.max;
  };
}

/**
 * Best-effort client IP extraction.
 * Prefers the first X-Forwarded-For entry (Amplify/Vercel proxy header).
 * @param request - The incoming request.
 * @returns The client IP, or "unknown" when no proxy header is present.
 */
export function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}
