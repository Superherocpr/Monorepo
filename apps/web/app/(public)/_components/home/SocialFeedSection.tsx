/**
 * SocialFeedSection — Instagram-style photo strip from the Facebook post cache.
 * Server component — reads from social_feed_cache table. Does NOT call Facebook API.
 * The cache is populated by a separate background job (Phase 10).
 * Shows 8 skeleton placeholder squares if the cache is empty.
 * Used by: app/(public)/page.tsx
 */

import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import type { SocialFeedPost } from "@/types/social";

/** Renders the "Follow Along" social media photo strip. */
export default async function SocialFeedSection() {
  const supabase = await createClient();

  const { data: photos } = await supabase
    .from("social_feed_cache")
    .select("id, photo_url, post_url, caption, posted_at")
    .order("posted_at", { ascending: false })
    .limit(8);

  return (
    <section className="py-20 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            Follow Along
          </h2>
          <p className="text-gray-600 text-sm mb-3">
            See what's happening at Superhero CPR on Facebook
          </p>
          <a
            href="https://www.facebook.com/Super-Hero-CPR-298899580537162/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-red-600 hover:text-red-700 transition-colors duration-150"
          >
            Follow us on Facebook →
          </a>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-2">
          {!photos || photos.length === 0
            ? // Empty state — 8 gray skeleton squares while cache is empty
              Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="shrink-0 w-36 h-36 md:w-44 md:h-44 bg-gray-200 rounded-lg"
                  aria-hidden="true"
                />
              ))
            : (photos as SocialFeedPost[]).map((photo) => (
                <a
                  key={photo.id}
                  href={photo.post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative shrink-0 w-36 h-36 md:w-44 md:h-44 rounded-lg overflow-hidden group"
                  aria-label={photo.caption ?? "Superhero CPR Facebook post"}
                >
                  <Image
                    src={photo.photo_url}
                    alt={photo.caption ?? "Superhero CPR class photo"}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    sizes="(max-width: 768px) 144px, 176px"
                  />
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </div>
                </a>
              ))}
        </div>
      </div>
    </section>
  );
}
