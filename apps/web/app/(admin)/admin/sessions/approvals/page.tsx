/**
 * GET /admin/sessions/approvals
 * Access: Manager and super admin only.
 * Shows all class sessions currently pending approval, split into two prioritized groups:
 *   1. Resubmissions — previously rejected sessions that have been updated (shown first)
 *   2. New Submissions — fresh sessions never previously rejected
 * Cards support inline approve/reject actions. A global Approve All button sits at the
 * bottom of the queue to clear everything in one action.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import type { UserRole } from "@/types/users";
import ApprovalsHeader from "./_components/ApprovalsHeader";
import ApprovalsEmptyState from "./_components/ApprovalsEmptyState";
import ResubmissionsSection from "./_components/ResubmissionsSection";
import NewSubmissionsSection from "./_components/NewSubmissionsSection";
import GlobalApproveAllButton from "./_components/GlobalApproveAllButton";
import type { PendingSession } from "./_components/ApprovalCard";

/**
 * Server component for the session approvals queue.
 * Fetches all pending sessions, splits them into resubmissions vs. new submissions,
 * and renders the appropriate sections or an empty state.
 */
export default async function ApprovalsPage() {
  // Only managers and super admins may access the approvals queue (honors view-as)
  const actor = await getAdminActor();
  if (!actor || !["manager", "super_admin"].includes(actor.effectiveRole)) {
    redirect("/admin");
  }

  const admin = await createAdminClient();

  const { data: pendingSessions } = await admin
    .from("class_sessions")
    .select(`
      id, starts_at, ends_at, rejection_reason, created_at,
      class_types ( name ),
      profiles ( first_name, last_name ),
      locations ( name, city, state )
    `)
    .eq("approval_status", "pending_approval")
    // Longest-waiting first; class_sessions has no updated_at column — ordered by created_at
    .order("created_at", { ascending: true });

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
        {totalPending > 1 && (
          <GlobalApproveAllButton sessionIds={sessions.map((s) => s.id)} />
        )}
      </div>
    </main>
  );
}
