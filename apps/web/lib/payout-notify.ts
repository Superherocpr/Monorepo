/**
 * Payout notification emails.
 *
 * Called after reconciliation by POST /api/payouts/sync and
 * POST /api/webhooks/paypal-payouts. Every function here is best-effort: a mail
 * failure is logged and swallowed, never allowed to abort reconciliation or turn
 * a webhook into a retry loop.
 *
 * Server-side only; never import from a client component.
 */

import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  instructorPayoutSentEmail,
  payoutDeniedAdminEmail,
  payoutStuckDigestAdminEmail,
  type PayoutStuckDigestBatch,
} from "@/lib/emails";

/** Admin Supabase client shape used by notification lookups. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, "public", any>;

/** Returns the configured app base URL for links inside emails. */
function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
}

/**
 * Alerts every active super_admin that PayPal denied a payout batch.
 *
 * This is the notification that closes the original gap: PayPal denies a batch
 * asynchronously and reports the reason only by email and in its dashboard, so
 * without this the returned funds could sit unnoticed indefinitely.
 *
 * Side effects: reads profiles + the batch row, sends one email via Resend.
 *
 * @param adminClient - Admin Supabase client.
 * @param batchId - Internal payout batch id that was denied.
 * @param paypalStatus - Raw PayPal status that triggered the denial.
 */
export async function notifyPayoutDenied(
  adminClient: AnySupabaseClient,
  batchId: string,
  paypalStatus: string
): Promise<void> {
  try {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      console.warn("[payout-notify] Resend not configured — skipping denial alert.");
      return;
    }

    const [{ data: batchRow }, { data: admins }] = await Promise.all([
      adminClient
        .from("instructor_payout_batches")
        .select("sender_batch_id, paypal_payout_batch_id, total_amount, item_count")
        .eq("id", batchId)
        .maybeSingle(),
      adminClient
        .from("profiles")
        .select("email")
        .eq("role", "super_admin")
        .eq("archived", false)
        .eq("deactivated", false),
    ]);

    if (!batchRow) return;

    const recipients = ((admins ?? []) as { email: string | null }[])
      .map((row) => row.email)
      .filter((email): email is string => Boolean(email));

    if (recipients.length === 0) return;

    const batch = batchRow as {
      sender_batch_id: string;
      paypal_payout_batch_id: string | null;
      total_amount: number | string;
      item_count: number;
    };

    const email = payoutDeniedAdminEmail({
      senderBatchId: batch.sender_batch_id,
      paypalBatchId: batch.paypal_payout_batch_id,
      totalAmount: Number(batch.total_amount) || 0,
      itemCount: batch.item_count,
      paypalStatus,
      baseUrl: getBaseUrl(),
    });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: recipients,
      subject: email.subject,
      html: email.html,
    });

    if (result.error) {
      console.error("[payout-notify] Denial alert email failed:", result.error);
    }
  } catch (err) {
    console.error("[payout-notify] Denial alert failed (non-fatal):", err);
  }
}

/**
 * Alerts every active super_admin about payout batches still stuck in
 * needs_review, denied, or failed.
 *
 * Unlike notifyPayoutDenied (fired once, at the moment of denial), this is
 * meant to be called repeatedly by a daily sweep — reconciliation only alerts
 * on the transition into denied, so a batch nobody actions after that first
 * email would otherwise go silent. The caller (POST /api/payouts/alert-stuck)
 * owns deciding which batches are due for re-alerting and marking them sent.
 *
 * Side effects: reads the given batch rows + profiles, sends one digest email.
 *
 * @param adminClient - Admin Supabase client.
 * @param batchIds - Internal payout batch ids to include in the digest.
 */
export async function notifyPayoutIssuesDigest(
  adminClient: AnySupabaseClient,
  batchIds: string[]
): Promise<void> {
  if (batchIds.length === 0) return;

  try {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      console.warn("[payout-notify] Resend not configured — skipping stuck-batch digest.");
      return;
    }

    const [{ data: batchRows }, { data: admins }] = await Promise.all([
      adminClient
        .from("instructor_payout_batches")
        .select("sender_batch_id, status, total_amount, item_count, created_at, denial_reason")
        .in("id", batchIds)
        .order("created_at", { ascending: false }),
      adminClient
        .from("profiles")
        .select("email")
        .eq("role", "super_admin")
        .eq("archived", false)
        .eq("deactivated", false),
    ]);

    const batches = (batchRows ?? []) as unknown as Array<{
      sender_batch_id: string;
      status: string;
      total_amount: number | string;
      item_count: number;
      created_at: string;
      denial_reason: string | null;
    }>;

    if (batches.length === 0) return;

    const recipients = ((admins ?? []) as { email: string | null }[])
      .map((row) => row.email)
      .filter((email): email is string => Boolean(email));

    if (recipients.length === 0) return;

    const digestBatches: PayoutStuckDigestBatch[] = batches.map((batch) => ({
      senderBatchId: batch.sender_batch_id,
      status: batch.status,
      totalAmount: Number(batch.total_amount) || 0,
      itemCount: batch.item_count,
      createdAt: batch.created_at,
      denialReason: batch.denial_reason,
    }));

    const email = payoutStuckDigestAdminEmail({
      batches: digestBatches,
      baseUrl: getBaseUrl(),
    });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: recipients,
      subject: email.subject,
      html: email.html,
    });

    if (result.error) {
      console.error("[payout-notify] Stuck-batch digest email failed:", result.error);
    }
  } catch (err) {
    console.error("[payout-notify] Stuck-batch digest failed (non-fatal):", err);
  }
}

/**
 * Tells instructors their payout was delivered.
 *
 * Only ever called for items PayPal has confirmed as SUCCESS, and only for items
 * that were not already completed — an instructor is never told they were paid
 * for a batch that later turns out to have been denied.
 *
 * Side effects: reads payout items + profiles, sends one email per instructor.
 *
 * @param adminClient - Admin Supabase client.
 * @param itemIds - Payout item ids that newly reached completed.
 */
export async function notifyInstructorsPaid(
  adminClient: AnySupabaseClient,
  itemIds: string[]
): Promise<void> {
  if (itemIds.length === 0) return;

  try {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      console.warn("[payout-notify] Resend not configured — skipping payout emails.");
      return;
    }

    const { data: itemRows } = await adminClient
      .from("instructor_payout_items")
      .select("id, amount, recipient_email, profiles!instructor_id (first_name, email)")
      .in("id", itemIds);

    const items = (itemRows ?? []) as unknown as Array<{
      id: string;
      amount: number | string;
      recipient_email: string;
      profiles: { first_name: string | null; email: string | null } | null;
    }>;

    if (items.length === 0) return;

    const resend = new Resend(process.env.RESEND_API_KEY);
    const baseUrl = getBaseUrl();

    for (const item of items) {
      const to = item.profiles?.email;
      if (!to) continue;

      const email = instructorPayoutSentEmail({
        firstName: item.profiles?.first_name ?? "there",
        amount: Number(item.amount) || 0,
        payoutEmail: item.recipient_email,
        baseUrl,
      });

      const result = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to,
        subject: email.subject,
        html: email.html,
      });

      if (result.error) {
        console.error(
          `[payout-notify] Payout email failed for item ${item.id}:`,
          result.error
        );
      }
    }
  } catch (err) {
    console.error("[payout-notify] Instructor payout emails failed (non-fatal):", err);
  }
}
