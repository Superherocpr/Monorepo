/**
 * sitemap.ts — generates the XML sitemap for SuperHeroCPR.
 * Includes all static public routes plus dynamically fetched published blog posts and tag pages.
 * Next.js serves this at /sitemap.xml automatically.
 */

import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";

const BASE_URL = "https://superherocpr.com";

/** Static routes that are always included in the sitemap. */
const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: `${BASE_URL}/`,           priority: 1.0, changeFrequency: "weekly" },
  { url: `${BASE_URL}/classes`,    priority: 0.9, changeFrequency: "weekly" },
  { url: `${BASE_URL}/book`,       priority: 0.9, changeFrequency: "weekly" },
  { url: `${BASE_URL}/about`,      priority: 0.7, changeFrequency: "monthly" },
  { url: `${BASE_URL}/contact`,    priority: 0.6, changeFrequency: "monthly" },
  { url: `${BASE_URL}/merch`,      priority: 0.5, changeFrequency: "weekly" },
  { url: `${BASE_URL}/blog`,       priority: 0.8, changeFrequency: "daily" },
];

/**
 * Generates the full site sitemap including blog posts and tag pages.
 * @returns Array of sitemap entries for Next.js to serialize as XML.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();

  // Fetch published posts and all tags in parallel.
  const [{ data: posts }, { data: tags }] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("slug, published_at, updated_at")
      .eq("status", "published")
      .order("published_at", { ascending: false }),

    supabase
      .from("blog_tags")
      .select("slug"),
  ]);

  const postEntries: MetadataRoute.Sitemap = (posts ?? []).map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: post.updated_at ?? post.published_at ?? undefined,
    priority: 0.7,
    changeFrequency: "monthly",
  }));

  const tagEntries: MetadataRoute.Sitemap = (tags ?? []).map((tag) => ({
    url: `${BASE_URL}/blog/tag/${tag.slug}`,
    priority: 0.6,
    changeFrequency: "weekly",
  }));

  return [...STATIC_ROUTES, ...postEntries, ...tagEntries];
}
