/**
 * Facebook Graph API fetcher for the social feed cache.
 * Fetches recent photo posts from the business Facebook page.
 * Called by: app/api/social/refresh/route.ts
 *
 * Requires environment variables:
 *   FACEBOOK_PAGE_ID            — numeric page ID or vanity name (e.g. "1HeroWay")
 *   FACEBOOK_PAGE_ACCESS_TOKEN  — long-lived Page Access Token (never expiring)
 */

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

/** Shape of a single item returned by the /feed Graph API endpoint. */
interface GraphFeedPost {
  id: string;
  message?: string;
  /** Highest-resolution image attached to the post — only present on photo posts. */
  full_picture?: string;
  permalink_url: string;
  created_time: string;
}

interface GraphFeedResponse {
  data: GraphFeedPost[];
  paging?: {
    cursors: { before: string; after: string };
    next?: string;
  };
}

/**
 * Fetches up to `limit` recent photo posts from the configured Facebook page.
 * Only posts that include a photo (`full_picture`) are returned — text-only posts
 * are filtered out so the feed always displays images.
 *
 * Requests three times as many items as needed to ensure enough photo posts remain
 * after the text-only filter is applied.
 *
 * @param limit - Maximum number of photo posts to return (default 12)
 * @returns Array of post data shaped for upsert into social_feed_cache
 * @throws Error if env vars are missing or the Graph API returns an error status
 */
export async function fetchFacebookPhotoPosts(
  limit: number = 12
): Promise<
  {
    facebook_post_id: string;
    photo_url: string;
    post_url: string;
    caption: string | null;
    posted_at: string;
  }[]
> {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId || !accessToken) {
    throw new Error(
      "FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN must be set to refresh the social feed"
    );
  }

  // Request more than needed so we have enough after filtering text-only posts
  const fetchLimit = limit * 3;

  const url = new URL(`${GRAPH_BASE}/${pageId}/feed`);
  url.searchParams.set(
    "fields",
    "id,message,full_picture,permalink_url,created_time"
  );
  url.searchParams.set("limit", String(fetchLimit));
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString(), {
    // Never cache this — it is only called when an intentional refresh is triggered
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`Facebook Graph API returned ${res.status}: ${body}`);
  }

  const json = (await res.json()) as GraphFeedResponse;

  return json.data
    .filter((post) => Boolean(post.full_picture))
    .slice(0, limit)
    .map((post) => ({
      facebook_post_id: post.id,
      photo_url: post.full_picture!,
      post_url: post.permalink_url,
      caption: post.message ?? null,
      posted_at: post.created_time,
    }));
}
