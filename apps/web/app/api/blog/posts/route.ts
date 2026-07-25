/**
 * GET /api/blog/posts
 * Called by: Public blog listing page and tag filter pages.
 * Auth: none — returns published posts only (enforced by RLS).
 * Query params:
 *   tag  — optional tag slug to filter by
 *   limit — optional max results (default 50)
 * Returns an array of BlogPostSummary with joined tags.
 */

import { createClient } from "@/lib/supabase/server";
import type { BlogPostSummary, BlogTag } from "@/types/blog";

/**
 * Lists published blog posts, optionally filtered by tag slug.
 * Tags are joined via the blog_post_tags junction table.
 * @param request - Incoming GET request with optional ?tag= and ?limit= params.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const tagSlug = searchParams.get("tag") ?? undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);

  const supabase = await createClient();

  // Fetch posts with their tags in one query via the junction table.
  let query = supabase
    .from("blog_posts")
    .select(`
      id, title, slug, excerpt, cover_image_url, published_at,
      blog_post_tags ( blog_tags ( id, name, slug ) )
    `)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);

  // If a tag slug is requested, filter posts that have that tag.
  if (tagSlug) {
    const { data: tag } = await supabase
      .from("blog_tags")
      .select("id")
      .eq("slug", tagSlug)
      .single();

    if (!tag) {
      return Response.json({ data: [], error: null });
    }

    query = query.filter("blog_post_tags.tag_id", "eq", tag.id);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[GET /api/blog/posts]", error.message);
    return Response.json({ data: null, error: "Failed to load posts" }, { status: 500 });
  }

  // Normalise the nested Supabase join shape into BlogPostSummary[].
  const posts: BlogPostSummary[] = (data ?? []).map((row) => {
    const rawTags = Array.isArray(row.blog_post_tags) ? row.blog_post_tags : [];
    const tags: BlogTag[] = rawTags
      .map((jt: { blog_tags: BlogTag | BlogTag[] | null }) => {
        const t = Array.isArray(jt.blog_tags) ? jt.blog_tags[0] : jt.blog_tags;
        return t ?? null;
      })
      .filter((t): t is BlogTag => t !== null);

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt ?? null,
      cover_image_url: row.cover_image_url ?? null,
      published_at: row.published_at ?? null,
      tags,
    };
  });

  // When filtering by tag, Supabase returns all posts but the junction rows for
  // non-matching tags come back empty — drop posts with no matching tag.
  const filtered = tagSlug
    ? posts.filter((p) => p.tags.some((t) => t.slug === tagSlug))
    : posts;

  return Response.json({ data: filtered, error: null });
}
