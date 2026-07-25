/**
 * GET  /api/admin/blog/posts — list all posts (draft + published) for the admin UI.
 * POST /api/admin/blog/posts — create a new blog post with tags.
 * Auth: super_admin only.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import type { BlogPost, BlogPostPayload, BlogTag } from "@/types/blog";

/**
 * Lists all blog posts for the admin, including draft posts, ordered newest first.
 * Tags are joined from the junction table.
 */
export async function GET(): Promise<Response> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  const supabase = await createAdminClient();

  const { data, error } = await supabase
    .from("blog_posts")
    .select(`
      id, title, slug, excerpt, cover_image_url,
      seo_title, seo_description, target_keyword,
      status, published_at, created_at, updated_at,
      blog_post_tags ( blog_tags ( id, name, slug ) )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /api/admin/blog/posts]", error.message);
    return Response.json({ data: null, error: "Failed to load posts" }, { status: 500 });
  }

  const posts: BlogPost[] = (data ?? []).map((row) => {
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
      body: "",
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
  });

  return Response.json({ data: posts, error: null });
}

/**
 * Creates a new blog post and associates its tags.
 * Sets published_at when status is 'published'.
 * Side effects: inserts into blog_posts and blog_post_tags.
 * @param request - JSON body matching BlogPostPayload.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  let payload: BlogPostPayload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ data: null, error: "Invalid JSON" }, { status: 400 });
  }

  const { title, slug, excerpt, body, cover_image_url, seo_title, seo_description, target_keyword, status, tag_ids } = payload;

  if (!title?.trim() || !slug?.trim()) {
    return Response.json({ data: null, error: "Title and slug are required" }, { status: 400 });
  }

  const supabase = await createAdminClient();

  const { data: post, error: insertError } = await supabase
    .from("blog_posts")
    .insert({
      title: title.trim(),
      slug: slug.trim(),
      excerpt: excerpt ?? null,
      body: body ?? "",
      cover_image_url: cover_image_url ?? null,
      seo_title: seo_title ?? null,
      seo_description: seo_description ?? null,
      target_keyword: target_keyword ?? null,
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (insertError) {
    console.error("[POST /api/admin/blog/posts]", insertError.message);
    const isDupe = insertError.code === "23505";
    return Response.json(
      { data: null, error: isDupe ? "A post with that slug already exists" : "Failed to create post" },
      { status: isDupe ? 409 : 500 }
    );
  }

  // Insert tag associations if any.
  if (tag_ids?.length) {
    const tagRows = tag_ids.map((tag_id) => ({ post_id: post.id, tag_id }));
    const { error: tagError } = await supabase.from("blog_post_tags").insert(tagRows);
    if (tagError) {
      console.error("[POST /api/admin/blog/posts] tag insert:", tagError.message);
    }
  }

  return Response.json({ data: post, error: null }, { status: 201 });
}
