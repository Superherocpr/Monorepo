/**
 * InstructorTeamSection — grid of published supporting instructor cards on the /about page.
 * Includes instructors, managers, and super admins who have bio_published = true.
 * Role labels are not shown — all appear simply as instructors to the public.
 * Returns null if no published, display-ready non-lead members exist.
 * Used by: app/(public)/about/page.tsx
 */

import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import sanitizeHtml from "sanitize-html";
import { createAdminClient } from "@/lib/supabase/server";
import { getInstructorBio } from "@/lib/bios";

interface PublicInstructorCard {
  /** Database profile ID used as the React key. */
  id: string;
  /** Full instructor name shown on the card and image alt text. */
  fullName: string;
  /** Renderable public photo URL or root-relative asset path. */
  photoSrc: string;
  /** Credential labels shown as checkmark items. */
  credentialItems: string[];
  /** Plain-text bio description from the database. Empty if markdown is used. */
  description: string;
  /** Sanitized-ready markdown HTML fallback. Null when the DB description is used. */
  contentHtml: string | null;
}

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
 * Returns true when Supabase failed because the launch migration has not run yet.
 * @param error - Supabase query error object.
 * @returns True for the known missing `bio_published` column condition.
 */
function isMissingBioPublishedColumnError(error: { message?: string }): boolean {
  return error.message?.includes("bio_published") === true;
}

/**
 * Builds one public card model when a profile has complete publishable bio content.
 * @param instructor - Published instructor profile row from Supabase.
 * @param bio - Optional markdown bio fallback for legacy content.
 * @returns A display-ready card model, or null when required public content is missing.
 */
function buildPublicInstructorCard(
  instructor: {
    id: string;
    first_name: string;
    last_name: string;
    bio_photo: string | null;
    bio_description: string | null;
    bio_credentials: string | null;
  },
  bio: Awaited<ReturnType<typeof getInstructorBio>>
): PublicInstructorCard | null {
  const fullName = `${instructor.first_name} ${instructor.last_name}`;
  const photoSrcCandidate = instructor.bio_photo ?? bio?.frontmatter.photo ?? null;
  const photoSrc = isRenderablePhotoSrc(photoSrcCandidate)
    ? photoSrcCandidate
    : null;
  const description = instructor.bio_description?.trim() ?? "";
  const contentHtml = description ? null : (bio?.contentHtml.trim() || null);

  if (!photoSrc || (!description && !contentHtml)) return null;

  return {
    id: instructor.id,
    fullName,
    photoSrc,
    description,
    contentHtml,
    // Parse DB credentials first; fall back to markdown frontmatter.
    credentialItems: instructor.bio_credentials
      ? instructor.bio_credentials.split(",").map((credential) => credential.trim()).filter(Boolean)
      : (bio?.frontmatter.credentials ?? []),
  };
}

/**
 * Renders a responsive card grid of published supporting instructors.
 * @returns The instructor team section, or null when no cards should be public.
 */
export default async function InstructorTeamSection() {
  // Use the admin client so RLS policies on the profiles table do not block
  // reads of public-facing instructor fields (name, photo, bio) for anonymous visitors.
  const supabase = await createAdminClient();

  const { data: instructors, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, bio_photo, bio_description, bio_credentials")
    .in("role", ["instructor", "super_admin", "manager"])
    .eq("is_lead_instructor", false)
    .eq("deactivated", false)
    .eq("bio_published", true)
    .order("last_name");

  if (error) {
    if (isMissingBioPublishedColumnError(error)) return null;
    console.error("[InstructorTeamSection] Failed to fetch published instructors:", error.message);
    return null;
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

  const publicInstructors = instructorsWithBios
    .map(({ instructor, bio }) => buildPublicInstructorCard(instructor, bio))
    .filter((card): card is PublicInstructorCard => card !== null);

  if (publicInstructors.length === 0) return null;

  return (
    <section className="py-20 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl font-semibold text-gray-900 mb-10">
          Our Instructor Team
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {publicInstructors.map((instructor) => {
            return (
              <div
                key={instructor.id}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col"
              >
                {/* Photo — cards are filtered before render, so this never shows a placeholder. */}
                <div className="relative w-full aspect-square bg-gray-100">
                  <Image
                    src={instructor.photoSrc}
                    alt={instructor.fullName}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                </div>

                {/* Card body */}
                <div className="p-5 flex flex-col gap-2 flex-1">
                  <h3 className="text-base font-semibold text-gray-900">{instructor.fullName}</h3>
                  <p className="text-xs text-red-600 font-semibold">AHA Certified Instructor</p>

                  {/* Credentials — checkmark list from DB or markdown frontmatter */}
                  {instructor.credentialItems.length > 0 && (
                    <ul className="flex flex-col gap-1 mt-1">
                      {instructor.credentialItems.map((credential) => (
                        <li key={credential} className="flex items-start gap-2 text-xs text-gray-600">
                          <CheckCircle2
                            className="text-red-600 mt-0.5 shrink-0"
                            size={13}
                            aria-hidden="true"
                          />
                          {credential}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Bio description — use DB bio_description if set, else fall back to markdown HTML */}
                  {instructor.description ? (
                    <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">
                      {instructor.description}
                    </p>
                  ) : instructor.contentHtml ? (
                    <div
                      className="prose prose-sm prose-gray max-w-none text-gray-600 mt-2"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(instructor.contentHtml),
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
