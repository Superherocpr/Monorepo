"use client";

/**
 * PayoutsClient: page shell for /admin/payouts.
 *
 * Owns the page heading, then delegates to PayoutSendSection (upcoming payouts with
 * checkboxes and the send bar) and PayoutHistoryPanel, both also used by
 * Settings → Payouts. Sync, deny, resend, and release actions live inside
 * PayoutHistoryPanel.
 *
 * Used by: app/(admin)/admin/payouts/page.tsx
 */

import PayoutSendSection from "@/app/(admin)/_components/PayoutSendSection";
import PayoutHistoryPanel from "@/app/(admin)/_components/PayoutHistoryPanel";
import type { PayoutHistoryBatch, UpcomingPayoutsData } from "@/types/payouts";

interface PayoutsClientProps {
  upcoming: UpcomingPayoutsData;
  history: PayoutHistoryBatch[];
}

/** Admin payout dashboard shell. */
export default function PayoutsClient({ upcoming, history }: PayoutsClientProps) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Instructor Payouts
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Review what instructors are owed, choose who to pay and for which classes, send the
          payout through PayPal, and track what PayPal actually did with each batch.
        </p>
      </div>

      <PayoutSendSection upcoming={upcoming} />
      <div className="mt-10">
        <PayoutHistoryPanel batches={history} />
      </div>
    </div>
  );
}
