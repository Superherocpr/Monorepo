/**
 * Enrollware Tool page — /admin/enrollware-tool
 * Allows instructors to generate and manage their Enrollware autofill bookmarklet,
 * and shows today's class sessions with student counts as a quick reference.
 * Used by: instructors, managers, and super admins (inspector role excluded).
 */

import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import BookmarkletSetup from "./_components/BookmarkletSetup";
import type { UserRole } from "@/types/users";

/** Roles permitted to use the Enrollware tool. Inspectors are excluded — they
 *  review sessions but do not submit them to Enrollware. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "manager", "super_admin"];

/** A today's-classes row for the at-a-glance section. */
interface TodaySession {
  id: string;
  starts_at: string;
  ends_at: string;
  enrollware_submitted: boolean;
  class_type_name: string | null;
  location_name: string | null;
  student_count: number;
}

/** Fetches today's class sessions for the given instructor profile. */
async function getTodaysSessions(profileId: string): Promise<TodaySession[]> {
  const admin = await createAdminClient();

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);

  const { data: sessions } = await admin
    .from("class_sessions")
    .select(
      `id, starts_at, ends_at, enrollware_submitted,
       class_types ( name ),
       locations ( name ),
       roster_records ( id )`
    )
    .eq("instructor_id", profileId)
    .gte("starts_at", todayStart.toISOString())
    .lte("starts_at", todayEnd.toISOString())
    .order("starts_at", { ascending: true });

  return (sessions ?? []).map((s) => {
    const classType = Array.isArray(s.class_types) ? s.class_types[0] : s.class_types;
    const location = Array.isArray(s.locations) ? s.locations[0] : s.locations;
    const students = Array.isArray(s.roster_records) ? s.roster_records : [];

    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      enrollware_submitted: s.enrollware_submitted ?? false,
      class_type_name: classType?.name ?? null,
      location_name: location?.name ?? null,
      student_count: students.length,
    };
  });
}

/** Returns true if the instructor has an active enrollware-bookmarklet API key. */
async function hasBookmarkletKey(profileId: string): Promise<boolean> {
  const admin = await createAdminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id")
    .eq("profile_id", profileId)
    .eq("label", "enrollware-bookmarklet")
    .single();
  return data !== null;
}

/** Formats an ISO timestamp as a human-readable time string (e.g. "9:00 AM"). */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function EnrollwareToolPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/enrollware-tool");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, first_name, role")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    redirect("/admin");
  }

  const [sessions, existingKey] = await Promise.all([
    getTodaysSessions(profile.id),
    hasBookmarkletKey(profile.id),
  ]);

  // Use the existing NEXT_PUBLIC_BASE_URL env var for the bookmarklet fetch URL.
  // Falls back to empty string if unset (bookmarklet will use a relative-looking path,
  // which won't work cross-origin — the env var should always be set in production).
  const siteUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Enrollware Tool</h1>
      <p className="mb-8 text-sm text-gray-500">
        Generate your personal bookmarklet to auto-fill Enrollware class forms and
        import student rosters directly from this database.
      </p>

      {/* Today's classes at-a-glance */}
      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Today&apos;s Classes
        </h2>

        {sessions.length === 0 ? (
          <p className="text-sm text-gray-500">No classes scheduled for today.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {s.class_type_name ?? "Unknown Course"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatTime(s.starts_at)} – {formatTime(s.ends_at)}
                    {s.location_name ? ` · ${s.location_name}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-xs text-gray-500">
                    {s.student_count} student{s.student_count !== 1 ? "s" : ""}
                  </span>
                  {s.enrollware_submitted ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      Submitted
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Pending
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bookmarklet setup */}
      <BookmarkletSetup hasExistingKey={existingKey} siteUrl={siteUrl} />
    </div>
  );
}
