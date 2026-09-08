/**
 * Admin Blog Page: /admin/blog
 * Lists all blog posts (draft + published) with status badges and quick actions.
 * Auth: super_admin only.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { requireApiRole } from "@/lib/auth/effective-role";
import { createAdminClient } from "@/lib/supabase/server";
import type { BlogPost, BlogTag } from "@/types/blog";

export const metadata = { title: "Blog Posts" };

/** Renders the blog post management list. */
export default async function AdminBlogPage(): Promise<React.ReactElement> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) redirect("/admin");

  const supabase = await createAdminClient();

  const { data: rawPosts } = await supabase
    .from("blog_posts")
    .select(`
      id, title, slug, status, published_at, created_at, updated_at,
      blog_post_tags ( blog_tags ( id, name, slug ) )
    `)
    .order("created_at", { ascending: false });

  const posts: BlogPost[] = (rawPosts ?? []).map((row) => {
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
      excerpt: null,
      body: "",
      cover_image_url: null,
      seo_title: null,
      seo_description: null,
      target_keyword: null,
      status: row.status as "draft" | "published",
      published_at: row.published_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      tags,
    };
  });

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Blog Posts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {posts.length} {posts.length === 1 ? "post" : "posts"} total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/blog/tags"
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            Manage tags
          </Link>
          <Link
            href="/admin/blog/new"
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
          >
            New post
          </Link>
        </div>
      </div>

      {/* Post list */}
      {posts.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No posts yet.</p>
          <Link
            href="/admin/blog/new"
            className="mt-3 inline-block text-sm text-red-600 hover:underline"
          >
            Write your first article
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Title</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Tags</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 w-28">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 w-32 hidden md:table-cell">Date</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {posts.map((post) => {
                const dateStr = (post.published_at ?? post.created_at)
                  ? new Date(post.published_at ?? post.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "-";

                return (
                  <tr key={post.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/blog/${post.id}`}
                        className="font-medium text-gray-900 hover:text-red-600 transition-colors"
                      >
                        {post.title}
                      </Link>
                      <p className="text-xs text-gray-400 mt-0.5">/blog/{post.slug}</p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {post.tags?.map((tag) => (
                          <span
                            key={tag.id}
                            className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full"
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "text-xs px-2 py-1 rounded-full font-medium",
                          post.status === "published"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600",
                        ].join(" ")}
                      >
                        {post.status === "published" ? "Published" : "Draft"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{dateStr}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/blog/${post.id}`}
                        className="text-xs text-gray-400 hover:text-red-600 transition-colors"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
