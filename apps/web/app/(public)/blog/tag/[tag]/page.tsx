/**
 * /blog/tag/[tag] — blog listing filtered to a single tag.
 * Separate URL per tag makes each a distinct SEO landing page.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BlogPostCard from "../../_components/BlogPostCard";
import TagFilter from "../../_components/TagFilter";
import type { BlogPostSummary, BlogTag } from "@/types/blog";
import Link from "next/link";

type PageProps = { params: Promise<{ tag: string }> };

/**
 * Generates metadata using the tag name so each tag page has a unique title/description.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tag: tagSlug } = await params;
  const supabase = await createClient();

  const { data: tag } = await supabase
    .from("blog_tags")
    .select("name")
    .eq("slug", tagSlug)
    .single();

  if (!tag) return { title: "Tag Not Found" };

  return {
    title: `${tag.name} Articles | SuperHeroCPR Blog`,
    description: `CPR and first aid articles about ${tag.name} from SuperHeroCPR instructors serving Hillsborough, Manatee, and Sarasota Counties.`,
  };
}

/**
 * Fetches and renders all published posts for a given tag slug.
 * 404s if the tag doesn't exist.
 */
export default async function TagPage({ params }: PageProps): Promise<React.ReactElement> {
  const { tag: tagSlug } = await params;
  const supabase = await createClient();

  const [{ data: tagRow }, { data: allTags }] = await Promise.all([
    supabase.from("blog_tags").select("id, name, slug, created_at").eq("slug", tagSlug).single(),
    supabase.from("blog_tags").select("id, name, slug, created_at").order("name"),
  ]);

  if (!tagRow) notFound();

  const tag = tagRow as BlogTag;

  // Fetch posts that have this tag via the junction table.
  const { data: rawPosts } = await supabase
    .from("blog_posts")
    .select(`
      id, title, slug, excerpt, cover_image_url, published_at,
      blog_post_tags!inner ( tag_id, blog_tags ( id, name, slug ) )
    `)
    .eq("status", "published")
    .eq("blog_post_tags.tag_id", tag.id)
    .order("published_at", { ascending: false });

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
        <Link href="/blog" className="text-sm text-gray-500 hover:text-red-600 transition-colors mb-4 inline-block">
          ← All articles
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{tag.name}</h1>
        <p className="text-gray-500 text-base">
          {posts.length} {posts.length === 1 ? "article" : "articles"} in this topic
        </p>
      </div>

      {/* Tag filter */}
      {allTags && allTags.length > 0 && (
        <div className="mb-8">
          <TagFilter tags={allTags as BlogTag[]} activeTag={tag.slug} />
        </div>
      )}

      {/* Post grid */}
      {posts.length === 0 ? (
        <p className="text-gray-400 text-sm">No articles in this topic yet.</p>
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
