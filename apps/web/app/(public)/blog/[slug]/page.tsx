/**
 * /blog/[slug] — individual blog post page.
 * Handles 301 redirects when a slug has been renamed (SEO preservation).
 * Based off of lessons taught by the lead instructor.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BlogPostContent from "../_components/BlogPostContent";
import TagFilter from "../_components/TagFilter";
import type { BlogPost, BlogTag } from "@/types/blog";
import Link from "next/link";

type PageProps = { params: Promise<{ slug: string }> };

/**
 * Generates dynamic metadata from the post's SEO fields.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("blog_posts")
    .select("title, seo_title, seo_description, excerpt")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (!data) return { title: "Article Not Found" };

  return {
    title: data.seo_title ?? data.title,
    description: data.seo_description ?? data.excerpt ?? undefined,
  };
}

/**
 * Fetches and renders a single published blog post.
 * Issues a Next.js redirect() when the slug has moved.
 */
export default async function BlogPostPage({ params }: PageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  const supabase = await createClient();

  // Check for a published post at this slug.
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

  if (error || !row) {
    // Check the redirect table before 404-ing.
    const { data: slugRedirect } = await supabase
      .from("blog_slug_redirects")
      .select("new_slug")
      .eq("old_slug", slug)
      .single();

    if (slugRedirect?.new_slug) {
      redirect(`/blog/${slugRedirect.new_slug}`);
    }

    notFound();
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
    status: "published",
    published_at: row.published_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    tags,
  };

  const publishedDate = post.published_at
    ? new Date(post.published_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  // Fetch all tags for the filter bar and the lead instructor name for the byline.
  const [{ data: allTags }, { data: leadInstructor }] = await Promise.all([
    supabase
      .from("blog_tags")
      .select("id, name, slug, created_at")
      .order("name"),
    supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("is_lead_instructor", true)
      .single(),
  ]);

  const instructorName = leadInstructor
    ? `${leadInstructor.first_name} ${leadInstructor.last_name}`
    : "our lead instructor";

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Back + tag filter */}
      <div className="mb-8 flex flex-col gap-4">
        <Link href="/blog" className="text-sm text-gray-500 hover:text-red-600 transition-colors">
          ← Back to all articles
        </Link>
        {allTags && allTags.length > 0 && (
          <TagFilter tags={allTags as BlogTag[]} activeTag={tags[0]?.slug ?? null} />
        )}
      </div>

      {/* Cover image */}
      {post.cover_image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.cover_image_url}
          alt={post.title}
          className="w-full rounded-xl object-cover mb-8 max-h-80"
        />
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {tags.map((tag) => (
            <a
              key={tag.id}
              href={`/blog/tag/${tag.slug}`}
              className="text-xs font-semibold text-red-600 uppercase tracking-wide hover:underline"
            >
              {tag.name}
            </a>
          ))}
        </div>
      )}

      {/* Title */}
      <h1 className="text-3xl font-bold text-gray-900 mb-3 leading-tight">{post.title}</h1>

      {/* Byline */}
      <p className="text-sm text-gray-400 mb-8">
        {publishedDate && <span>{publishedDate} · </span>}
        Based off of lessons taught by <span className="font-medium text-gray-600">{instructorName}</span>
      </p>

      {/* Article body */}
      <BlogPostContent body={post.body} />
    </main>
  );
}
