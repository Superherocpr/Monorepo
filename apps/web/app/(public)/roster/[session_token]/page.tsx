/**
 * /roster/[session_token] — Student roster correction page.
 * Public — no login required. Students confirm or correct their personal
 * information for a class session imported by a manager.
 * Used on class day. Correction window closes 30 minutes after class start.
 * Used by: students attending group/corporate invoice-based classes.
 */

import { createClient } from "@/lib/supabase/server";
import RosterCorrectionClient from "./_components/RosterCorrectionClient";

/** Next.js 15+: params is a Promise in App Router. */
interface PageProps {
  params: Promise<{ session_token: string }>;
}

/**
 * Validates the session token and renders the correction UI, or an
 * appropriate error message if the token is invalid, the roster hasn't been
 * imported, or the correction window has closed.
 * @param params - Dynamic route params containing session_token
 */
export default async function RosterCorrectionPage({ params }: PageProps) {
  const { session_token } = await params;
  const supabase = await createClient();

  // ── Fetch session ────────────────────────────────────────────────────────
  const { data: session } = await supabase
    .from("class_sessions")
    .select(
      "id, starts_at, correction_window_closes_at, roster_imported, class_types ( name ), locations ( name )"
    )
    .eq("session_token", session_token)
    .maybeSingle();

  const classTypeName =
    (session?.class_types as unknown as { name: string } | null)?.name ?? "Class";

  // ── Guard: invalid token ─────────────────────────────────────────────────
  if (!session) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-start justify-center pt-16 px-4">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-lg shadow-sm p-6 text-center">
          <p className="text-gray-700">
            This link is not valid. Please ask your instructor for the correct link.
          </p>
        </div>
      </main>
    );
  }

  // ── Guard: roster not yet imported ───────────────────────────────────────
  if (!session.roster_imported) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-start justify-center pt-16 px-4">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-lg shadow-sm p-6 text-center">
          <p className="text-gray-700">
            The roster for this class hasn&apos;t been set up yet. Please check back
            later or ask your instructor.
          </p>
        </div>
      </main>
    );
  }

  // ── Guard: correction window closed ─────────────────────────────────────
  const windowClosed =
    session.correction_window_closes_at
      ? new Date(session.correction_window_closes_at) < new Date()
      : false;

  if (windowClosed) {
    const dateStr = new Date(session.starts_at).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    return (
      <main className="min-h-screen bg-gray-50 flex items-start justify-center pt-16 px-4">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-lg shadow-sm p-6 text-center space-y-2">
          <p className="text-gray-700">The correction window for this class has closed.</p>
          <p className="font-semibold text-gray-900">{classTypeName}</p>
          <p className="text-gray-600 text-sm">{dateStr}</p>
          <p className="text-gray-500 text-sm mt-4">
            If you need to make a change, please contact your instructor.
          </p>
        </div>
      </main>
    );
  }

  // ── Fetch roster records for this session ────────────────────────────────
  // Full record fields are passed to the client so the edit form can pre-populate.
  // device_token is NOT passed — only a boolean indicating whether one is set.
  // This prevents exposing another student's device token via the page source.
  const { data: records } = await supabase
    .from("roster_records")
    .select("id, first_name, last_name, email, phone, employer, confirmed, device_token")
    .eq("session_id", session.id)
    .order("last_name")
    .order("first_name");

  const locationName =
    (session.locations as unknown as { name: string } | null)?.name ?? "";

  return (
    <RosterCorrectionClient
      sessionId={session.id}
      classTypeName={classTypeName}
      locationName={locationName}
      startsAt={session.starts_at}
      correctionWindowClosesAt={session.correction_window_closes_at ?? ""}
      records={(records ?? []).map((r) => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email ?? null,
        phone: r.phone ?? null,
        employer: r.employer ?? null,
        confirmed: r.confirmed,
        // Only tell the client whether a token is set — not the token itself
        hasDeviceToken: r.device_token != null,
      }))}
    />
  );
}
