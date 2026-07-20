/**
 * Rollcall QR display page — /admin/sessions/[id]/checkin
 * Server component: designed to be projected or shown to students in the
 * classroom. Shows a large QR code + the instructor's daily rollcall code,
 * plus a live-updating list of students who have verified for THIS session.
 * Only the session's own instructor may view it (the refresh action
 * regenerates the caller's own code, so it must be their session).
 * Auth guard is provided by app/(admin)/layout.tsx.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import { isSameBusinessDay } from "@/lib/business-time";
import CheckinDisplayClient, {
  type VerifiedStudent,
} from "./_components/CheckinDisplayClient";

/** Props passed to Next.js dynamic route pages. */
interface PageProps {
  params: Promise<{ id: string }>;
}

/** Roster record subset used to build the verified list. */
interface RosterRow {
  first_name: string;
  last_name: string;
  confirmed: boolean;
}

/** Fetches session, code, and verified students, then renders the display. */
export default async function CheckinDisplayPage({ params }: PageProps) {
  const { id } = await params;

  // Auth guard — honors view-as, same as the session detail page.
  const actor = await getAdminActor();
  if (!actor) redirect(`/signin?redirect=/admin/sessions/${id}/checkin`);

  const admin = await createAdminClient();

  const { data: session } = await admin
    .from("class_sessions")
    .select(
      `
      id, starts_at, status, approval_status, instructor_id,
      class_types ( name ),
      locations ( name ),
      roster_records ( first_name, last_name, confirmed )
    `
    )
    .eq("id", id)
    .single();

  if (!session) redirect("/admin/sessions");

  // Only the session's own instructor may open the display — the refresh
  // button regenerates the caller's own daily code, which would desync the
  // QR from the class if a different user pressed it.
  if (session.instructor_id !== actor.user.id) {
    redirect(`/admin/sessions/${id}`);
  }

  // Fetch the instructor's current rollcall code. A code generated on a
  // previous business day is expired (mirrors verify-code) — pass null so
  // the client prompts for a fresh one instead of displaying a dead QR.
  const { data: profile } = await admin
    .from("profiles")
    .select("daily_access_code, access_code_generated_at")
    .eq("id", session.instructor_id)
    .single();

  const codeIsCurrent =
    profile?.daily_access_code &&
    profile.access_code_generated_at &&
    isSameBusinessDay(new Date(profile.access_code_generated_at), new Date());

  // Students who actively confirmed their info via rollcall for this session.
  const verified: VerifiedStudent[] = (
    (session.roster_records as RosterRow[] | null) ?? []
  )
    .filter((r) => r.confirmed)
    .map((r) => ({ firstName: r.first_name, lastName: r.last_name }));

  // Nested to-one relations are typed as arrays by Supabase typegen but are
  // single objects at runtime. Cast through unknown to bridge.
  const classType = session.class_types as unknown as { name: string } | null;
  const location = session.locations as unknown as { name: string } | null;

  return (
    <CheckinDisplayClient
      sessionId={session.id}
      classTypeName={classType?.name ?? "Class"}
      locationName={location?.name ?? ""}
      startsAt={session.starts_at}
      initialCode={codeIsCurrent ? profile!.daily_access_code : null}
      initialVerified={verified}
    />
  );
}
