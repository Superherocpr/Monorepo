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

/** Production fallback headshot used when the lead profile has no uploaded photo. */
const FALLBACK_INSTRUCTOR_PHOTO = "/images/Untitled-2.jpg";

/**
 * Returns true if a photo source is safe to pass to next/image.
 * Accepts root-relative paths and http/https absolute URLs.
 * @param value - Candidate photo URL from DB or markdown frontmatter.
 * @returns True when the value can be rendered as an image source.
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

/**
 * Renders the lead instructor card with photo, credentials, stats, and bio.
 * @returns The lead instructor section.
 */
export default async function LeadInstructorSection() {
  // Use the admin client so RLS policies do not block reads of public-facing
  // instructor fields (name, photo, bio) for anonymous visitors.
  const supabase = await createAdminClient();

  const { data: instructor, error } = await supabase
    .from("profiles")
    .select("first_name, last_name, bio_photo, bio_description, bio_credentials, bio_years_experience, bio_students_trained")
    .eq("is_lead_instructor", true)
    .maybeSingle();

  if (error) {
    console.error("[LeadInstructorSection] Failed to fetch lead instructor:", error.message);
  }

  const bio = await getLeadInstructorBio();

  // If the DB profile is not ready yet, still render a polished production
  // section so the public page never exposes setup/internal state.
  if (!instructor) {
    return (
      <section className="py-20 px-4 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="relative w-full aspect-square max-w-sm mx-auto rounded-xl overflow-hidden bg-gray-100">
            <Image
              src={FALLBACK_INSTRUCTOR_PHOTO}
              alt="SuperHeroCPR lead instructor"
              fill
              className="object-cover object-top"
              sizes="(max-width: 768px) 100vw, 384px"
              priority
            />
          </div>
          <div className="mx-auto max-w-prose">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Real-World Emergency Experience
            </h2>
            <p className="text-gray-700 leading-relaxed">
              SuperHeroCPR classes are taught by AHA-certified instructors with
              frontline Fire, EMS, and Emergency Room experience. You get calm,
              practical training from people who understand what it feels like
              when seconds matter.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const fullName = `${instructor.first_name} ${instructor.last_name}`;
  const photoSrcCandidate = instructor.bio_photo ?? bio?.frontmatter.photo ?? null;
  const photoSrc = isRenderablePhotoSrc(photoSrcCandidate)
    ? photoSrcCandidate
    : FALLBACK_INSTRUCTOR_PHOTO;
  // Parse DB credentials first; fall back to markdown frontmatter.
  // Split on comma, trim whitespace, drop empty strings.
  const credentialItems: string[] = instructor.bio_credentials
    ? instructor.bio_credentials.split(",").map((c: string) => c.trim()).filter(Boolean)
    : (bio?.frontmatter.credentials ?? []);

  // Prefer DB stats over markdown frontmatter values.
  const yearsExperience = instructor.bio_years_experience ?? bio?.frontmatter.years_experience?.toString() ?? null;
  const studentsTrained = instructor.bio_students_trained ?? bio?.frontmatter.students_trained?.toString() ?? null;

  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* Left column — photo, credentials, stats */}
          <div className="flex flex-col gap-6 items-center">
            {/* Photo — use DB bio_photo if set, else fall back to markdown/frontmatter asset */}
            <div className="relative w-full aspect-square max-w-sm mx-auto rounded-xl overflow-hidden bg-gray-100">
              <Image
                src={photoSrc}
                alt={fullName}
                fill
                className="object-cover object-top"
                sizes="(max-width: 768px) 100vw, 384px"
                priority
                unoptimized
              />
            </div>

            {/* Name */}
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900">{fullName}</h2>
              <div className="mt-3 flex justify-center">
                <div className="relative h-[58px] w-[224px]">
                  <Image
                    src="/images/aha-authorized-training-site.png"
                    alt="American Heart Association Authorized Training Site"
                    fill
                    className="object-contain"
                    sizes="224px"
                  />
                </div>
              </div>
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

            {/* Stats — DB values take priority over markdown frontmatter */}
            {(yearsExperience || studentsTrained) && (
              <div className="flex gap-8">
                {yearsExperience && (
                  <div>
                    <p className="text-3xl font-extrabold text-red-600">
                      {yearsExperience}+
                    </p>
                    <p className="text-sm text-gray-500">Years experience</p>
                  </div>
                )}
                {studentsTrained && (
                  <div>
                    <p className="text-3xl font-extrabold text-red-600">
                      {studentsTrained}
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
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap mx-auto max-w-prose">
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
