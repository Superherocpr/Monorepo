/**
 * GET    /api/admin/blog/posts/[id] — fetch a single post (including body) for editing.
 * PUT    /api/admin/blog/posts/[id] — update post fields and tags.
 * DELETE /api/admin/blog/posts/[id] — delete a post (unpublish-only for published posts is handled client-side).
 * Auth: super_admin only.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import type { BlogPost, BlogPostPayload, BlogTag } from "@/types/blog";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Fetches a single post by ID including its body and tags. Used by the editor.
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const supabase = await createAdminClient();

  const { data: row, error } = await supabase
    .from("blog_posts")
    .select(`
      id, title, slug, excerpt, body, cover_image_url,
      seo_title, seo_description, target_keyword,
      status, published_at, created_at, updated_at,
      blog_post_tags ( blog_tags ( id, name, slug ) )
    `)
    .eq("id", id)
    .single();

  if (error) {
    const status = error.code === "PGRST116" ? 404 : 500;
    return Response.json({ data: null, error: status === 404 ? "Post not found" : "Failed to load post" }, { status });
  }

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

  return Response.json({ data: post, error: null });
}

/**
 * Updates a blog post's fields and replaces its tag associations.
 * When slug changes on a published post, saves the old slug as a redirect.
 * Side effects: updates blog_posts, replaces blog_post_tags rows, may insert blog_slug_redirects.
 * @param request - JSON body matching BlogPostPayload.
 */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;

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

  // Fetch the current post to detect slug changes.
  const { data: existing } = await supabase
    .from("blog_posts")
    .select("slug, status, published_at")
    .eq("id", id)
    .single();

  if (!existing) {
    return Response.json({ data: null, error: "Post not found" }, { status: 404 });
  }

  const slugChanged = existing.slug !== slug.trim();
  const wasPublished = existing.status === "published";

  // If slug changed on a post that has ever been published, store a redirect.
  if (slugChanged && wasPublished) {
    await supabase
      .from("blog_slug_redirects")
      .upsert({ old_slug: existing.slug, new_slug: slug.trim() }, { onConflict: "old_slug" });
  }

  // Set published_at when transitioning to published for the first time.
  const published_at =
    status === "published" && !existing.published_at
      ? new Date().toISOString()
      : existing.published_at ?? null;

  const { data: updated, error: updateError } = await supabase
    .from("blog_posts")
    .update({
      title: title.trim(),
      slug: slug.trim(),
      excerpt: excerpt ?? null,
      body: body ?? "",
      cover_image_url: cover_image_url ?? null,
      seo_title: seo_title ?? null,
      seo_description: seo_description ?? null,
      target_keyword: target_keyword ?? null,
      status,
      published_at,
    })
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    console.error("[PUT /api/admin/blog/posts/[id]]", updateError.message);
    const isDupe = updateError.code === "23505";
    return Response.json(
      { data: null, error: isDupe ? "A post with that slug already exists" : "Failed to update post" },
      { status: isDupe ? 409 : 500 }
    );
  }

  // Replace all tag associations atomically.
  await supabase.from("blog_post_tags").delete().eq("post_id", id);

  if (tag_ids?.length) {
    const tagRows = tag_ids.map((tag_id) => ({ post_id: id, tag_id }));
    const { error: tagError } = await supabase.from("blog_post_tags").insert(tagRows);
    if (tagError) {
      console.error("[PUT /api/admin/blog/posts/[id]] tag insert:", tagError.message);
    }
  }

  return Response.json({ data: updated, error: null });
}

/**
 * Deletes a blog post. The junction rows cascade via FK.
 * Side effects: deletes blog_posts row (blog_post_tags cascade).
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const supabase = await createAdminClient();

  const { error } = await supabase.from("blog_posts").delete().eq("id", id);

  if (error) {
    console.error("[DELETE /api/admin/blog/posts/[id]]", error.message);
    return Response.json({ data: null, error: "Failed to delete post" }, { status: 500 });
  }

  return Response.json({ data: null, error: null });
}
