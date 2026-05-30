/**
 * Admin Payouts page — /admin/payouts
 * Access: super_admin only.
 * Shows pending instructor earnings, blocked payout setup, and recent PayPal payout batches.
 */

import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import PayoutsClient, {
  type PayoutBatchSummary,
  type PayoutsPageData,
  type PendingPayoutGroup,
} from "@/app/(admin)/_components/PayoutsClient";

export const metadata = { title: "Instructor Payouts | SuperHeroCPR Admin" };

/** Raw pending earning row returned by Supabase with instructor join. */
interface RawPendingEarning {
  id: string;
  instructor_id: string;
  gross_amount: number | string;
  platform_fee_amount: number | string;
  instructor_amount: number | string;
  profiles: {
    first_name: string;
    last_name: string;
    email: string;
    paypal_payout_email: string | null;
  } | null;
}

/** Raw payout batch row returned by Supabase. */
interface RawPayoutBatch {
  id: string;
  status: string;
  sender_batch_id: string;
  paypal_payout_batch_id: string | null;
  total_amount: number | string;
  item_count: number;
  error_message: string | null;
  created_at: string;
  submitted_at: string | null;
  completed_at: string | null;
}

/** Converts a numeric DB value to a JavaScript number. */
function money(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Groups pending earning rows by instructor for the admin dashboard. */
function groupPendingEarnings(rows: RawPendingEarning[]): PendingPayoutGroup[] {
  const groups = new Map<string, PendingPayoutGroup>();

  for (const row of rows) {
    const profile = row.profiles;
    const existing = groups.get(row.instructor_id);
    const instructorName = profile
      ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Instructor"
      : "Instructor";

    if (!existing) {
      groups.set(row.instructor_id, {
        instructorId: row.instructor_id,
        instructorName,
        instructorEmail: profile?.email ?? "",
        paypalPayoutEmail: profile?.paypal_payout_email ?? null,
        pendingGrossAmount: money(row.gross_amount),
        pendingPlatformFeeAmount: money(row.platform_fee_amount),
        pendingInstructorAmount: money(row.instructor_amount),
        earningCount: 1,
      });
      continue;
    }

    existing.pendingGrossAmount += money(row.gross_amount);
    existing.pendingPlatformFeeAmount += money(row.platform_fee_amount);
    existing.pendingInstructorAmount += money(row.instructor_amount);
    existing.earningCount += 1;
  }

  return Array.from(groups.values()).sort((left, right) =>
    left.instructorName.localeCompare(right.instructorName)
  );
}

/** Maps raw payout batch DB rows to the client display shape. */
function mapPayoutBatches(rows: RawPayoutBatch[]): PayoutBatchSummary[] {
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    senderBatchId: row.sender_batch_id,
    paypalPayoutBatchId: row.paypal_payout_batch_id,
    totalAmount: money(row.total_amount),
    itemCount: row.item_count,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
  }));
}

/** Server component for the super-admin payout dashboard. */
export default async function PayoutsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/payouts");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, archived, deactivated")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.role !== "super_admin" ||
    profile.archived ||
    profile.deactivated
  ) {
    redirect("/admin");
  }

  const adminClient = await createAdminClient();
  const [{ data: pendingRows }, { data: batchRows }] = await Promise.all([
    adminClient
      .from("instructor_earnings")
      .select(`
        id,
        instructor_id,
        gross_amount,
        platform_fee_amount,
        instructor_amount,
        profiles!instructor_id (
          first_name,
          last_name,
          email,
          paypal_payout_email
        )
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    adminClient
      .from("instructor_payout_batches")
      .select(`
        id,
        status,
        sender_batch_id,
        paypal_payout_batch_id,
        total_amount,
        item_count,
        error_message,
        created_at,
        submitted_at,
        completed_at
      `)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const pendingGroups = groupPendingEarnings((pendingRows ?? []) as unknown as RawPendingEarning[]);
  const pendingTotal = pendingGroups.reduce(
    (sum, group) => sum + group.pendingInstructorAmount,
    0
  );
  const payableTotal = pendingGroups
    .filter((group) => group.paypalPayoutEmail)
    .reduce((sum, group) => sum + group.pendingInstructorAmount, 0);

  const pageData: PayoutsPageData = {
    pendingGroups,
    recentBatches: mapPayoutBatches((batchRows ?? []) as RawPayoutBatch[]),
    pendingTotal,
    payableTotal,
  };

  return <PayoutsClient data={pageData} />;
}
