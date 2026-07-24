"use client";

/** TagFilter — horizontal pill buttons for filtering blog posts by tag. Used on /blog. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { BlogTag } from "@/types/blog";

interface TagFilterProps {
  tags: BlogTag[];
  /** The currently active tag slug, or null for "All". */
  activeTag: string | null;
}

/**
 * Renders an "All" pill plus one pill per tag. Active pill is highlighted in red.
 * Navigates to /blog or /blog/tag/[slug] on click.
 * @param tags - All available tags.
 * @param activeTag - The currently selected tag slug, or null.
 */
export default function TagFilter({ tags, activeTag }: TagFilterProps): React.ReactElement {
  const pathname = usePathname();
  void pathname;

  const pillBase =
    "px-4 py-1.5 rounded-full text-sm font-medium transition-colors duration-150 border";
  const active = "bg-red-600 text-white border-red-600";
  const inactive = "bg-white text-gray-600 border-gray-300 hover:border-red-400 hover:text-red-600";

  return (
    <div className="flex flex-wrap gap-2" role="navigation" aria-label="Filter by topic">
      <Link href="/blog" className={`${pillBase} ${activeTag === null ? active : inactive}`}>
        All
      </Link>
      {tags.map((tag) => (
        <Link
          key={tag.id}
          href={`/blog/tag/${tag.slug}`}
          className={`${pillBase} ${activeTag === tag.slug ? active : inactive}`}
        >
          {tag.name}
        </Link>
      ))}
    </div>
  );
}
