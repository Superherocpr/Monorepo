/**
 * Admin roster import page — /admin/sessions/[id]/roster
 * Server component: verifies manager/super admin access, fetches session info,
 * existing roster emails (for duplicate detection), and any pending customer upload.
 * Passes all data to RosterImportClient for the interactive 4-step import flow.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import RosterImportClient, {
  type RosterSessionInfo,
  type PendingUpload,
} from "../../../../_components/RosterImportClient";
import type { UserRole } from "@/types/users";

/** Props passed to Next.js dynamic route pages. */
interface PageProps {
  params: Promise<{ id: string }>;
}

/** Fetches prerequisite data and renders the roster import UI. */
export default async function RosterImportPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/signin?redirect=/admin/sessions/${id}/roster`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/");

  const role = profile.role as UserRole;

  // Only managers and super admins may access the roster import tool
  if (!["manager", "super_admin"].includes(role)) {
    redirect(`/admin/sessions/${id}`);
  }

  // Fetch session info needed to display the page header
  const { data: session } = await supabase
    .from("class_sessions")
    .select(
      "id, starts_at, max_capacity, class_types ( name ), locations ( name )"
    )
    .eq("id", id)
    .single();

  if (!session) redirect("/admin/sessions");

  // Fetch existing roster emails — used client-side for duplicate detection.
  // We pass the Set as an array since props must be serialisable.
  const { data: existing } = await supabase
    .from("roster_records")
    .select("email")
    .eq("session_id", id);

  const existingEmails = (existing ?? [])
    .map((r: { email: string | null }) => r.email?.toLowerCase() ?? "")
    .filter(Boolean);

  // Check for an unimported customer roster upload for this session
  const { data: pendingUpload } = await supabase
    .from("roster_uploads")
    .select(
      "id, file_url, original_filename, submitted_by_name, created_at"
    )
    .eq("session_id", id)
    .eq("imported", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sessionInfo: RosterSessionInfo = {
    id: session.id,
    starts_at: session.starts_at,
    max_capacity: session.max_capacity,
    class_type_name: (session.class_types as { name: string } | null)?.name ?? "Class",
    location_name: (session.locations as { name: string } | null)?.name ?? "Unknown Location",
  };

  return (
    <RosterImportClient
      session={sessionInfo}
      existingEmails={existingEmails}
      pendingUpload={(pendingUpload as PendingUpload | null) ?? null}
    />
  );
}
