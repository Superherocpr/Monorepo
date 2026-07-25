/**
 * DELETE /api/admin/blog/tags/[id] — delete a tag and its junction rows (cascade).
 * Auth: super_admin only.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Deletes a tag by ID. Junction rows in blog_post_tags cascade via FK.
 * Side effects: deletes blog_tags row.
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const supabase = await createAdminClient();

  const { error } = await supabase.from("blog_tags").delete().eq("id", id);

  if (error) {
    console.error("[DELETE /api/admin/blog/tags/[id]]", error.message);
    return Response.json({ data: null, error: "Failed to delete tag" }, { status: 500 });
  }

  return Response.json({ data: null, error: null });
}
