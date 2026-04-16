/**
 * TypeScript interfaces for social feed and misc database tables.
 * Covers: social_feed_cache.
 * Source of truth: schema.md — do not modify column names without verifying there first.
 */

/**
 * A cached Facebook photo post from the `social_feed_cache` table.
 * Populated by a background job (not yet implemented — see AI-DEV-BRIEF.md).
 * The home page must handle an empty table gracefully.
 */
export interface SocialFeedPost {
  id: string;
  facebook_post_id: string;
  photo_url: string;
  post_url: string;
  caption: string | null;
  posted_at: string;
  cached_at: string;
}
