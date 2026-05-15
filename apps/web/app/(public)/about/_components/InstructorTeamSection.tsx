/**
 * InstructorTeamSection — grid of supporting instructor cards on the /about page.
 * Returns null if no non-lead instructors exist — renders nothing, no empty state.
 * Used by: app/(public)/about/page.tsx
 */

import Image from "next/image";
import sanitizeHtml from "sanitize-html";
import { createAdminClient } from "@/lib/supabase/server";
import { getInstructorBio } from "@/lib/bios";

/**
 * Returns true if a photo source is safe to pass to next/image.
 * Accepts root-relative paths and http/https absolute URLs.
 * @param value - Candidate photo URL from DB or markdown frontmatter.
 */
function isRenderablePhotoSrc(value: string | null | undefined): value is string {
  if (!value) return false;
  if (value.startsWith("/")) return true;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Renders a responsive card grid of supporting instructors. Returns null if none exist. */
export default async function InstructorTeamSection() {
  // Use the admin client so RLS policies on the profiles table do not block
  // reads of public-facing instructor fields (name, photo, bio) for anonymous visitors.
  const supabase = await createAdminClient();

  const { data: instructors, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, bio_photo, bio_description")
    .eq("role", "instructor")
    .eq("is_lead_instructor", false)
    .order("last_name");

  if (error) {
    console.error("[InstructorTeamSection] Failed to fetch instructors:", error.message);
  }

  if (!instructors || instructors.length === 0) return null;

  // Load each instructor's markdown bio file in parallel — slugged from name; missing files return null
  const instructorsWithBios = await Promise.all(
    instructors.map(async (instructor) => {
      const slug = `${instructor.first_name}-${instructor.last_name}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "");
      const bio = await getInstructorBio(slug);
      return { instructor, bio };
    })
  );

  return (
    <section className="py-20 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl font-semibold text-gray-900 mb-10">
          Our Instructor Team
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {instructorsWithBios.map(({ instructor, bio }) => {
            const fullName = `${instructor.first_name} ${instructor.last_name}`;
            const photoSrcCandidate = instructor.bio_photo ?? bio?.frontmatter.photo ?? null;
            const photoSrc = isRenderablePhotoSrc(photoSrcCandidate)
              ? photoSrcCandidate
              : null;
            return (
              <div
                key={instructor.id}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col"
              >
                {/* Photo — use DB bio_photo if set, else fall back to markdown frontmatter */}
                <div className="relative w-full aspect-square bg-gray-100">
                  {photoSrc ? (
                    <Image
                      src={photoSrc}
                      alt={fullName}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-sm">
                      Photo coming soon
                    </div>
                  )}
                </div>

                {/* Card body */}
                <div className="p-5 flex flex-col gap-2 flex-1">
                  <h3 className="text-base font-semibold text-gray-900">{fullName}</h3>

                  {bio?.frontmatter.credentials && bio.frontmatter.credentials.length > 0 && (
                    <p className="text-xs text-gray-500">
                      {bio.frontmatter.credentials.join(", ")}
                    </p>
                  )}

                  {/* Bio description — use DB bio_description if set, else fall back to markdown HTML */}
                  {instructor.bio_description ? (
                    <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">
                      {instructor.bio_description}
                    </p>
                  ) : bio?.contentHtml ? (
                    <div
                      className="prose prose-sm prose-gray max-w-none text-gray-600 mt-2"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(bio.contentHtml),
                      }}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
