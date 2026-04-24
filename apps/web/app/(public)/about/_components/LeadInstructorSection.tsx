/**
 * LeadInstructorSection — highlights the lead instructor on the /about page.
 * Fetches the lead instructor's profile from the database and bio from the filesystem.
 * Used by: app/(public)/about/page.tsx
 */

import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import sanitizeHtml from "sanitize-html";
import { createClient } from "@/lib/supabase/server";
import { getLeadInstructorBio } from "@/lib/bios";

/** Renders the lead instructor card with photo, credentials, stats, and bio. */
export default async function LeadInstructorSection() {
  const supabase = await createClient();

  const { data: instructor } = await supabase
    .from("profiles")
    .select("first_name, last_name, bio_slug")
    .eq("is_lead_instructor", true)
    .single();

  const bio = await getLeadInstructorBio();

  // If no lead instructor profile exists in the DB, render a placeholder
  if (!instructor) {
    return (
      <section className="py-20 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          {/* TODO: add lead instructor profile to the database */}
          <p className="text-gray-400 text-sm text-center">
            Instructor profile coming soon.
          </p>
        </div>
      </section>
    );
  }

  const fullName = `${instructor.first_name} ${instructor.last_name}`;

  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">

          {/* Left column — photo, credentials, stats */}
          <div className="flex flex-col gap-6">
            {/* Photo */}
            <div className="relative w-full aspect-square max-w-sm mx-auto lg:mx-0 rounded-xl overflow-hidden bg-gray-100">
              {bio?.frontmatter.photo ? (
                // TODO: replace placeholder with actual instructor photo
                <Image
                  src={bio.frontmatter.photo}
                  alt={fullName}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 384px"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                  Photo coming soon
                </div>
              )}
            </div>

            {/* Name */}
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{fullName}</h2>
              {/* TODO: add AHA logo asset to /public/images/aha-logo.png */}
              <p className="text-sm text-red-600 font-semibold mt-1">
                AHA Certified Instructor
              </p>
            </div>

            {/* Credentials */}
            {bio?.frontmatter.credentials && bio.frontmatter.credentials.length > 0 && (
              <ul className="flex flex-col gap-2">
                {bio.frontmatter.credentials.map((cred) => (
                  <li key={cred} className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle2
                      className="text-red-600 mt-0.5 shrink-0"
                      size={16}
                      aria-hidden="true"
                    />
                    {cred}
                  </li>
                ))}
              </ul>
            )}

            {/* Stats */}
            {(bio?.frontmatter.years_experience || bio?.frontmatter.students_trained) && (
              <div className="flex gap-8">
                {bio.frontmatter.years_experience && (
                  <div>
                    <p className="text-3xl font-extrabold text-red-600">
                      {bio.frontmatter.years_experience}+
                    </p>
                    <p className="text-sm text-gray-500">Years experience</p>
                  </div>
                )}
                {bio.frontmatter.students_trained && (
                  <div>
                    <p className="text-3xl font-extrabold text-red-600">
                      {bio.frontmatter.students_trained}
                    </p>
                    <p className="text-sm text-gray-500">Students trained</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right column — bio HTML */}
          {bio?.contentHtml && (
            <div
              className="prose prose-gray max-w-none text-gray-700 leading-relaxed"
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(bio.contentHtml),
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
