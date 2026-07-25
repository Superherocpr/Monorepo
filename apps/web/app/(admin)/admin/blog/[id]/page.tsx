/**
 * Admin Edit Blog Post Page — /admin/blog/[id]
 * Fetches the full post (including body) and all tags, renders BlogEditorClient pre-populated.
 * Auth: super_admin only.
 */

import { redirect, notFound } from "next/navigation";
import { requireApiRole } from "@/lib/auth/effective-role";
import { createAdminClient } from "@/lib/supabase/server";
import BlogEditorClient from "../_components/BlogEditorClient";
import type { BlogPost, BlogTag } from "@/types/blog";

type PageProps = { params: Promise<{ id: string }> };

export const metadata = { title: "Edit Blog Post" };

/** Fetches the post and all tags, then renders the populated editor. */
export default async function EditBlogPostPage({ params }: PageProps): Promise<React.ReactElement> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) redirect("/admin");

  const { id } = await params;
  const supabase = await createAdminClient();

  const [{ data: rowData, error }, { data: rawTags }] = await Promise.all([
    supabase
      .from("blog_posts")
      .select(`
        id, title, slug, excerpt, body, cover_image_url,
        seo_title, seo_description, target_keyword,
        status, published_at, created_at, updated_at,
        blog_post_tags ( blog_tags ( id, name, slug ) )
      `)
      .eq("id", id)
      .single(),

    supabase
      .from("blog_tags")
      .select("id, name, slug, created_at")
      .order("name"),
  ]);

  if (error || !rowData) notFound();

  const rawTags2 = Array.isArray(rowData.blog_post_tags) ? rowData.blog_post_tags : [];
  const tags: BlogTag[] = rawTags2
    .map((jt: { blog_tags: BlogTag | BlogTag[] | null }) => {
      const t = Array.isArray(jt.blog_tags) ? jt.blog_tags[0] : jt.blog_tags;
      return t ?? null;
    })
    .filter((t): t is BlogTag => t !== null);

  const post: BlogPost = {
    id: rowData.id,
    title: rowData.title,
    slug: rowData.slug,
    excerpt: rowData.excerpt ?? null,
    body: rowData.body,
    cover_image_url: rowData.cover_image_url ?? null,
    seo_title: rowData.seo_title ?? null,
    seo_description: rowData.seo_description ?? null,
    target_keyword: rowData.target_keyword ?? null,
    status: rowData.status as "draft" | "published",
    published_at: rowData.published_at ?? null,
    created_at: rowData.created_at,
    updated_at: rowData.updated_at,
    tags,
  };

  const allTags: BlogTag[] = (rawTags ?? []) as BlogTag[];

  return <BlogEditorClient post={post} allTags={allTags} />;
}
