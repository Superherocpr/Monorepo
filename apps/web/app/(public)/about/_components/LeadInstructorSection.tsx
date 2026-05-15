/**
 * LeadInstructorSection — highlights the lead instructor on the /about page.
 * Fetches the lead instructor's profile from the database and bio from the filesystem.
 * Used by: app/(public)/about/page.tsx
 */

import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import sanitizeHtml from "sanitize-html";
import { createAdminClient } from "@/lib/supabase/server";
import { getLeadInstructorBio } from "@/lib/bios";

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

/** Renders the lead instructor card with photo, credentials, stats, and bio. */
export default async function LeadInstructorSection() {
  // Use the admin client so RLS policies do not block reads of public-facing
  // instructor fields (name, photo, bio) for anonymous visitors.
  const supabase = await createAdminClient();

  const { data: instructor, error } = await supabase
    .from("profiles")
    .select("first_name, last_name, bio_photo, bio_description, bio_credentials")
    .eq("is_lead_instructor", true)
    .maybeSingle();

  if (error) {
    console.error("[LeadInstructorSection] Failed to fetch lead instructor:", error.message);
  }

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
  const photoSrcCandidate = instructor.bio_photo ?? bio?.frontmatter.photo ?? null;
  const photoSrc = isRenderablePhotoSrc(photoSrcCandidate) ? photoSrcCandidate : null;
  // Parse DB credentials first; fall back to markdown frontmatter.
  // Split on comma, trim whitespace, drop empty strings.
  const credentialItems: string[] = instructor.bio_credentials
    ? instructor.bio_credentials.split(",").map((c) => c.trim()).filter(Boolean)
    : (bio?.frontmatter.credentials ?? []);

  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">

          {/* Left column — photo, credentials, stats */}
          <div className="flex flex-col gap-6">
            {/* Photo — use DB bio_photo if set, else fall back to markdown frontmatter */}
            <div className="relative w-full aspect-square max-w-sm mx-auto lg:mx-0 rounded-xl overflow-hidden bg-gray-100">
              {photoSrc ? (
                // TODO: replace placeholder with actual instructor photo
                <Image
                  src={photoSrc}
                  alt={fullName}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 384px"
                  unoptimized
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

            {/* Credentials — DB credentials take priority over markdown frontmatter */}
            {credentialItems.length > 0 && (
              <ul className="flex flex-col gap-2">
                {credentialItems.map((cred) => (
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

          {/* Right column — bio description from DB, falling back to markdown HTML */}
          {(instructor.bio_description || bio?.contentHtml) && (
            instructor.bio_description ? (
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                {instructor.bio_description}
              </p>
            ) : (
              <div
                className="prose prose-gray max-w-none text-gray-700 leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(bio!.contentHtml),
                }}
              />
            )
          )}
        </div>
      </div>
    </section>
  );
}
