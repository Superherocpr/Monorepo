/** Shared TypeScript types for the blog feature. */

/** A tag row as stored in blog_tags. created_at is optional when fetched via nested join. */
export interface BlogTag {
  id: string;
  name: string;
  slug: string;
  created_at?: string;
}

/** A blog post row as stored in blog_posts. */
export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  target_keyword: string | null;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /** Tags joined from blog_post_tags → blog_tags. Present when fetched with tags. */
  tags?: BlogTag[];
}

/** Minimal post shape used on listing and card components. */
export interface BlogPostSummary {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  tags: BlogTag[];
}

/** Payload for creating or updating a blog post. */
export interface BlogPostPayload {
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  target_keyword: string | null;
  status: "draft" | "published";
  tag_ids: string[];
}
