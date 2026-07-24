/**
 * Admin New Blog Post Page — /admin/blog/new
 * Renders BlogEditorClient pre-loaded with all tags and no existing post data.
 * Auth: super_admin only.
 */

import { redirect } from "next/navigation";
import { requireApiRole } from "@/lib/auth/effective-role";
import { createAdminClient } from "@/lib/supabase/server";
import BlogEditorClient from "../_components/BlogEditorClient";
import type { BlogTag } from "@/types/blog";

export const metadata = { title: "New Blog Post" };

/** Fetches all tags and renders the blank editor. */
export default async function NewBlogPostPage(): Promise<React.ReactElement> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) redirect("/admin");

  const supabase = await createAdminClient();
  const { data: rawTags } = await supabase
    .from("blog_tags")
    .select("id, name, slug, created_at")
    .order("name");

  const allTags: BlogTag[] = (rawTags ?? []) as BlogTag[];

  return <BlogEditorClient allTags={allTags} />;
}
