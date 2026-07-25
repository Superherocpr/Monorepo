/**
 * GET  /api/admin/blog/tags — list all tags.
 * POST /api/admin/blog/tags — create a new tag.
 * Auth: super_admin only (GET is also used by the editor client-side via fetch).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import type { BlogTag } from "@/types/blog";

/** Lists all tags ordered alphabetically by name. */
export async function GET(): Promise<Response> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("blog_tags")
    .select("id, name, slug, created_at")
    .order("name");

  if (error) {
    console.error("[GET /api/admin/blog/tags]", error.message);
    return Response.json({ data: null, error: "Failed to load tags" }, { status: 500 });
  }

  return Response.json({ data: data as BlogTag[], error: null });
}

/**
 * Creates a new blog tag. Auto-generates a URL-safe slug from the name.
 * @param request - JSON body with { name: string }.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ data: null, error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return Response.json({ data: null, error: "Tag name is required" }, { status: 400 });
  }

  // Generate a URL-safe slug from the name.
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("blog_tags")
    .insert({ name, slug })
    .select()
    .single();

  if (error) {
    console.error("[POST /api/admin/blog/tags]", error.message);
    const isDupe = error.code === "23505";
    return Response.json(
      { data: null, error: isDupe ? "A tag with that name already exists" : "Failed to create tag" },
      { status: isDupe ? 409 : 500 }
    );
  }

  return Response.json({ data: data as BlogTag, error: null }, { status: 201 });
}
