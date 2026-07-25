/** BlogPostCard — summary card shown on /blog and /blog/tag/[tag] listing pages. */

import Link from "next/link";
import type { BlogPostSummary } from "@/types/blog";

interface BlogPostCardProps {
  post: BlogPostSummary;
}

/**
 * Renders a single blog post summary card with cover image, tags, title, excerpt, and date.
 * @param post - The blog post summary data to display.
 */
export default function BlogPostCard({ post }: BlogPostCardProps): React.ReactElement {
  const publishedDate = post.published_at
    ? new Date(post.published_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow duration-200"
    >
      {/* Cover image */}
      {post.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.cover_image_url}
          alt={post.title}
          className="w-full h-48 object-cover"
        />
      ) : (
        <div className="w-full h-48 bg-red-50 flex items-center justify-center">
          <span className="text-4xl" aria-hidden="true">🦸</span>
        </div>
      )}

      <div className="flex flex-col flex-1 p-6 gap-3">
        {/* Tags */}
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span
                key={tag.id}
                className="text-xs font-semibold text-red-600 uppercase tracking-wide"
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* Title */}
        <h2 className="text-lg font-bold text-gray-900 group-hover:text-red-600 transition-colors duration-150 leading-snug">
          {post.title}
        </h2>

        {/* Excerpt */}
        {post.excerpt && (
          <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">{post.excerpt}</p>
        )}

        {/* Date */}
        {publishedDate && (
          <p className="mt-auto pt-2 text-xs text-gray-400">{publishedDate}</p>
        )}
      </div>
    </Link>
  );
}
