/**
 * /blog — public blog listing page.
 * Fetches all published posts and all tags server-side.
 * Tag filter navigation is handled client-side via TagFilter links to /blog/tag/[slug].
 */

import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import BlogPostCard from "./_components/BlogPostCard";
import TagFilter from "./_components/TagFilter";
import type { BlogPostSummary, BlogTag } from "@/types/blog";

export const metadata: Metadata = {
  title: "CPR & First Aid Blog | SuperHeroCPR",
  description:
    "Expert CPR tips, AHA certification guides, and life-saving resources from licensed instructors serving Hillsborough, Manatee, and Sarasota Counties.",
};

/**
 * Fetches and renders all published blog posts with tag filter navigation.
 */
export default async function BlogPage(): Promise<React.ReactElement> {
  const supabase = await createClient();

  const [{ data: rawPosts }, { data: rawTags }] = await Promise.all([
    supabase
      .from("blog_posts")
      .select(`
        id, title, slug, excerpt, cover_image_url, published_at,
        blog_post_tags ( blog_tags ( id, name, slug ) )
      `)
      .eq("status", "published")
      .order("published_at", { ascending: false }),

    supabase
      .from("blog_tags")
      .select("id, name, slug, created_at")
      .order("name"),
  ]);

  const tags: BlogTag[] = (rawTags ?? []) as BlogTag[];

  const posts: BlogPostSummary[] = (rawPosts ?? []).map((row) => {
    const rawTagRows = Array.isArray(row.blog_post_tags) ? row.blog_post_tags : [];
    const postTags: BlogTag[] = rawTagRows
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
      tags: postTags,
    };
  });

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Page header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">CPR &amp; First Aid Resources</h1>
        <p className="text-gray-500 text-base">
          Expert guides, certification tips, and life-saving information from our instructors.
        </p>
      </div>

      {/* Tag filter */}
      {tags.length > 0 && (
        <div className="mb-8">
          <TagFilter tags={tags} activeTag={null} />
        </div>
      )}

      {/* Post grid */}
      {posts.length === 0 ? (
        <p className="text-gray-400 text-sm">No articles published yet. Check back soon.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((post) => (
            <BlogPostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </main>
  );
}
