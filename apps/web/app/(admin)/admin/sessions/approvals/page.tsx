/**
 * GET /admin/sessions/approvals
 * Access: Manager and super admin only.
 * Shows all class sessions currently pending approval, split into two prioritized groups:
 *   1. Resubmissions — previously rejected sessions that have been updated (shown first)
 *   2. New Submissions — fresh sessions never previously rejected
 * Approve/reject actions are on the session detail page; this is a review queue only.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";
import ApprovalsHeader from "./_components/ApprovalsHeader";
import ApprovalsEmptyState from "./_components/ApprovalsEmptyState";
import ResubmissionsSection from "./_components/ResubmissionsSection";
import NewSubmissionsSection from "./_components/NewSubmissionsSection";
import type { PendingSession } from "./_components/ApprovalCard";

/**
 * Server component for the session approvals queue.
 * Fetches all pending sessions, splits them into resubmissions vs. new submissions,
 * and renders the appropriate sections or an empty state.
 */
export default async function ApprovalsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/sessions/approvals");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/");

  const role = profile.role as UserRole;

  // Only managers and super admins may access the approvals queue
  if (!["manager", "super_admin"].includes(role)) {
    redirect("/admin");
  }

  const { data: pendingSessions } = await supabase
    .from("class_sessions")
    .select(`
      id, starts_at, ends_at, rejection_reason, updated_at,
      class_types ( name ),
      profiles ( first_name, last_name ),
      locations ( name, city, state )
    `)
    .eq("approval_status", "pending_approval")
    // Longest-waiting first; resubmissions may have been submitted long ago
    .order("updated_at", { ascending: true });

  const sessions = (pendingSessions ?? []) as unknown as PendingSession[];

  // Resubmissions: sessions that were previously rejected — identified by a non-null rejection_reason.
  // A session that was never rejected will not have a rejection_reason set.
  const resubmissions = sessions.filter((s) => s.rejection_reason !== null);
  const newSubmissions = sessions.filter((s) => s.rejection_reason === null);

  const totalPending = sessions.length;

  if (totalPending === 0) {
    return <ApprovalsEmptyState />;
  }

  return (
    <main>
      <ApprovalsHeader count={totalPending} />
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <ResubmissionsSection sessions={resubmissions} />
        <NewSubmissionsSection sessions={newSubmissions} />
      </div>
    </main>
  );
}
