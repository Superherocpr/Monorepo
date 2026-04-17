/**
 * InstructorTeamSection — grid of supporting instructor cards on the /about page.
 * Returns null if no non-lead instructors exist — renders nothing, no empty state.
 * Used by: app/(public)/about/page.tsx
 */

import Image from "next/image";
import sanitizeHtml from "sanitize-html";
import { createClient } from "@/lib/supabase/server";
import { getInstructorBio } from "@/lib/bios";

/** Renders a responsive card grid of supporting instructors. Returns null if none exist. */
export default async function InstructorTeamSection() {
  const supabase = await createClient();

  const { data: instructors } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, bio_slug")
    .eq("role", "instructor")
    .eq("is_lead_instructor", false)
    .order("last_name");

  if (!instructors || instructors.length === 0) return null;

  // Load each instructor's bio file in parallel — missing files return null
  const instructorsWithBios = await Promise.all(
    instructors.map(async (instructor) => {
      const bio = instructor.bio_slug
        ? await getInstructorBio(instructor.bio_slug)
        : null;
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
            return (
              <div
                key={instructor.id}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col"
              >
                {/* Photo */}
                <div className="relative w-full aspect-square bg-gray-100">
                  {bio?.frontmatter.photo ? (
                    <Image
                      src={bio.frontmatter.photo}
                      alt={fullName}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
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

                  {bio?.contentHtml && (
                    <div
                      className="prose prose-sm prose-gray max-w-none text-gray-600 mt-2"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(bio.contentHtml),
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
