/**
 * GET /api/blog/posts/[slug]
 * Called by: Public blog post page (/blog/[slug]).
 * Auth: none — returns published posts only (enforced by RLS).
 * Also checks blog_slug_redirects so the page can issue a 301 if the slug moved.
 * Returns { data: BlogPost | null, redirect: string | null, error: string | null }
 */

import { createClient } from "@/lib/supabase/server";
import type { BlogPost, BlogTag } from "@/types/blog";

/**
 * Fetches a single published blog post by slug.
 * If not found, checks the redirect table so the page can serve a 301.
 * @param _request - Unused; slug comes from the route segment.
 * @param context - Route context containing the slug param.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await context.params;
  const supabase = await createClient();

  // Try the canonical slug first.
  const { data: row, error } = await supabase
    .from("blog_posts")
    .select(`
      id, title, slug, excerpt, body, cover_image_url,
      seo_title, seo_description, target_keyword,
      status, published_at, created_at, updated_at,
      blog_post_tags ( blog_tags ( id, name, slug ) )
    `)
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("[GET /api/blog/posts/[slug]]", error.message);
    return Response.json({ data: null, redirect: null, error: "Failed to load post" }, { status: 500 });
  }

  if (row) {
    const rawTags = Array.isArray(row.blog_post_tags) ? row.blog_post_tags : [];
    const tags: BlogTag[] = rawTags
      .map((jt: { blog_tags: BlogTag | BlogTag[] | null }) => {
        const t = Array.isArray(jt.blog_tags) ? jt.blog_tags[0] : jt.blog_tags;
        return t ?? null;
      })
      .filter((t): t is BlogTag => t !== null);

    const post: BlogPost = {
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt ?? null,
      body: row.body,
      cover_image_url: row.cover_image_url ?? null,
      seo_title: row.seo_title ?? null,
      seo_description: row.seo_description ?? null,
      target_keyword: row.target_keyword ?? null,
      status: row.status as "draft" | "published",
      published_at: row.published_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      tags,
    };

    return Response.json({ data: post, redirect: null, error: null });
  }

  // Post not found — check the redirect table for a slug that was renamed.
  const { data: redirect } = await supabase
    .from("blog_slug_redirects")
    .select("new_slug")
    .eq("old_slug", slug)
    .single();

  if (redirect?.new_slug) {
    return Response.json({ data: null, redirect: redirect.new_slug, error: null });
  }

  return Response.json({ data: null, redirect: null, error: null }, { status: 404 });
}
