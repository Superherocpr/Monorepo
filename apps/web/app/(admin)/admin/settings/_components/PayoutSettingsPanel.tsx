"use client";

/**
 * PayoutSettingsPanel: payout configuration section for the admin settings page.
 * Lets super_admins control the platform fee percentage, payout trigger mode
 * (immediate / scheduled / manual), and the schedule interval.
 * Also exposes a "Send Payouts Now" button for on-demand manual disbursements.
 * Used by: app/(admin)/admin/settings/page.tsx (rendered as payoutsSlot)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, AlertCircle, Send, Zap, Clock, HandCoins, TrendingDown } from "lucide-react";
import type { PayoutTrigger, PayoutSchedule } from "@/app/api/settings/payouts/route";
import UpcomingPayoutsPanel from "@/app/(admin)/_components/UpcomingPayoutsPanel";
import PayoutHistoryPanel from "@/app/(admin)/_components/PayoutHistoryPanel";
import {
  breakEvenFeePercent,
  compareBatchingCost,
  estimatePlatformMargin,
} from "@/lib/payout-fees";
import { formatCurrency } from "@/lib/invoice-utils";
import type { PayoutHistoryBatch, UpcomingPayoutsData } from "@/types/payouts";

/** Class prices used to illustrate margin at both ends of the catalog. */
const MARGIN_EXAMPLE_PRICES = [50, 100];

interface PayoutSettingsPanelProps {
  /** Current platform fee percentage (0–100). */
  initialFeePercent: number;
  /** Current payout trigger mode. */
  initialTrigger: PayoutTrigger;
  /** Current payout schedule interval. */
  initialSchedule: PayoutSchedule;
  /** Upcoming payout data for the tracking panel. */
  upcoming: UpcomingPayoutsData;
  /** Recent payout batches for the history panel. */
  history: PayoutHistoryBatch[];
}

interface Toast {
  type: "success" | "error";
  message: string;
}

/** Shared input style. */
const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 " +
  "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 " +
  "focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white";

/** Radio option card rendered for each trigger mode. */
interface TriggerOption {
  value: PayoutTrigger;
  label: string;
  description: string;
  icon: React.ReactNode;
}

/** Schedule dropdown option. */
interface ScheduleOption {
  value: PayoutSchedule;
  label: string;
  description: string;
}

const TRIGGER_OPTIONS: TriggerOption[] = [
  {
    value: "immediate",
    label: "Immediate",
    description:
      "A payout is sent to each instructor automatically right after every customer payment. Fastest delivery but creates one batch per transaction.",
    icon: <Zap className="h-5 w-5 text-yellow-500" />,
  },
  {
    value: "scheduled",
    label: "Scheduled",
    description:
      "Payouts are batched and sent automatically on the interval you choose below. Efficient and predictable.",
    icon: <Clock className="h-5 w-5 text-blue-500" />,
  },
  {
    value: "manual",
    label: "Manual only",
    description:
      'Earnings accumulate until you push "Send Payouts Now". Full control; nothing goes out automatically.',
    icon: <HandCoins className="h-5 w-5 text-gray-500" />,
  },
];

const SCHEDULE_OPTIONS: ScheduleOption[] = [
  { value: "daily", label: "Daily", description: "Every day at 5:00 AM UTC" },
  { value: "weekly", label: "Weekly", description: "Every Monday at 5:00 AM UTC" },
  { value: "monthly", label: "Monthly", description: "1st of each month at 5:00 AM UTC" },
];

/** Response shape expected from POST /api/payouts/create. */
interface PayoutCreateResponse {
  success: boolean;
  error?: string;
  paypalBatchId?: string;
}

/**
 * Shows what the configured platform fee actually nets after PayPal's fees, and
 * warns when the fee is set below break-even.
 *
 * Both PayPal fees come out of the platform's cut: the instructor gets their
 * full percentage of gross: so a low fee percentage can lose money on every
 * booking. Break-even is higher for cheaper classes, because PayPal's fixed
 * per-transaction charge is a bigger share of a smaller sale.
 */
function MarginReadout({ feePercent }: { feePercent: number }) {
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) return null;

  const instructorShare = 100 - feePercent;
  const examples = MARGIN_EXAMPLE_PRICES.map((price) => ({
    price,
    margin: estimatePlatformMargin(price, feePercent),
    breakEven: breakEvenFeePercent(price),
  }));
  const losingMoney = examples.filter((example) => example.margin.netMargin < 0);
  const highestBreakEven = examples.reduce<number | null>(
    (highest, example) =>
      example.breakEven === null
        ? highest
        : highest === null
          ? example.breakEven
          : Math.max(highest, example.breakEven),
    null
  );

  return (
    <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Instructors receive{" "}
        <span className="font-semibold text-gray-900 dark:text-white">
          {instructorShare.toFixed(1)}%
        </span>{" "}
        of each payment. PayPal&rsquo;s fees come out of your share, not theirs:
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="text-left text-gray-500 dark:text-gray-400">
            <tr>
              <th className="py-1.5 pr-4 font-medium">Class price</th>
              <th className="py-1.5 pr-4 text-right font-medium">Your cut</th>
              <th className="py-1.5 pr-4 text-right font-medium">PayPal in</th>
              <th className="py-1.5 pr-4 text-right font-medium">PayPal out</th>
              <th className="py-1.5 text-right font-medium">You actually keep</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
            {examples.map(({ price, margin }) => (
              <tr key={price}>
                <td className="py-1.5 pr-4 text-gray-700 dark:text-gray-300">
                  {formatCurrency(price)}
                </td>
                <td className="py-1.5 pr-4 text-right text-gray-600 dark:text-gray-400">
                  {formatCurrency(margin.platformCut)}
                </td>
                <td className="py-1.5 pr-4 text-right text-red-700 dark:text-red-400">
                  −{formatCurrency(margin.inboundFee)}
                </td>
                <td className="py-1.5 pr-4 text-right text-red-700 dark:text-red-400">
                  −{formatCurrency(margin.outboundFee)}
                </td>
                <td
                  className={`py-1.5 text-right font-semibold ${
                    margin.netMargin >= 0
                      ? "text-green-700 dark:text-green-400"
                      : "text-red-700 dark:text-red-400"
                  }`}
                >
                  {formatCurrency(margin.netMargin)}
                  {margin.netMarginPercent !== null ? (
                    <span className="ml-1 font-normal text-gray-400">
                      ({margin.netMarginPercent.toFixed(1)}%)
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {losingMoney.length > 0 ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            At {feePercent.toFixed(1)}% you lose money on{" "}
            {losingMoney.map((example) => formatCurrency(example.price)).join(" and ")} classes
            after PayPal&rsquo;s fees.
            {highestBreakEven !== null
              ? ` You need at least ${highestBreakEven.toFixed(1)}% to break even across these prices.`
              : ""}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
          Estimated using PayPal&rsquo;s standard US rates (2.9% + $0.30 to collect, 2% capped at
          $1.00 to send). Actual fees are recorded per payment and shown in the tracking panel
          below.
        </p>
      )}
    </div>
  );
}

/**
 * Compares what the currently queued payouts would cost in immediate mode versus
 * batched, using PayPal's per-recipient payout fee.
 *
 * PayPal caps the payout fee per recipient, so combining an instructor's earnings
 * into one payout costs the cap once, while immediate mode pays it per booking.
 * Renders nothing when there is no difference to show.
 */
function BatchingCostNote({ upcoming }: { upcoming: UpcomingPayoutsData }) {
  const amountsByInstructor = upcoming.payableNow.map((group) =>
    group.sources.flatMap((source) =>
      // Sources are grouped per class, so split the class total across the
      // students sold to approximate the individual payments behind it.
      Array.from({ length: Math.max(1, source.soldCount) }, () =>
        source.instructorAmount / Math.max(1, source.soldCount)
      )
    )
  );

  const comparison = compareBatchingCost(amountsByInstructor);
  if (comparison.savings <= 0 || comparison.earningCount === 0) return null;

  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
      <TrendingDown className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        <strong>Batching is cheaper.</strong> The {comparison.earningCount} payment
        {comparison.earningCount === 1 ? "" : "s"} currently queued for{" "}
        {comparison.instructorCount} instructor
        {comparison.instructorCount === 1 ? "" : "s"} would cost about{" "}
        {formatCurrency(comparison.immediateCost)} in PayPal payout fees sent individually in
        Immediate mode, versus {formatCurrency(comparison.batchedCost)} combined, a difference
        of {formatCurrency(comparison.savings)}. PayPal caps its payout fee per recipient, so
        one combined payout per instructor pays that cap once instead of per booking.
      </span>
    </div>
  );
}

/**
 * Payout settings and manual send panel for super_admins.
 * All state is local; saves to /api/settings/payouts on submit.
 */
export default function PayoutSettingsPanel({
  initialFeePercent,
  initialTrigger,
  initialSchedule,
  upcoming,
  history,
}: PayoutSettingsPanelProps) {
  const router = useRouter();

  // ── Form state ─────────────────────────────────────────────────────────────
  const [feePercent, setFeePercent] = useState(String(initialFeePercent));
  const [trigger, setTrigger] = useState<PayoutTrigger>(initialTrigger);
  const [schedule, setSchedule] = useState<PayoutSchedule>(initialSchedule);

  // ── Button states ──────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<Toast | null>(null);

  /**
   * Shows a toast notification. Success auto-dismisses after 4 seconds.
   * @param type - "success" or "error"
   * @param message - Message text to display.
   */
  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    if (type === "success") setTimeout(() => setToast(null), 4000);
  }

  /**
   * Saves platform fee, trigger, and schedule to /api/settings/payouts.
   * Side effects: writes to system_settings table, refreshes server components.
   */
  async function handleSave() {
    const parsedFee = parseFloat(feePercent);
    if (isNaN(parsedFee) || parsedFee < 0 || parsedFee > 100) {
      showToast("error", "Platform fee must be a number between 0 and 100.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings/payouts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformFeePercent: parsedFee,
          payoutTrigger: trigger,
          payoutSchedule: schedule,
        }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !data.success) {
        showToast("error", data.error ?? "Failed to save payout settings.");
        return;
      }
      showToast("success", "Payout settings saved.");
      // Refresh server components so the new fee takes effect on the next earning
      router.refresh();
    } catch {
      showToast("error", "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Immediately sends all pending eligible earnings as a PayPal payout batch.
   * Calls POST /api/payouts/create. Refreshes the page on success so the
   * payout dashboard and pending counts reflect the new state.
   * Side effects: creates payout batch + items in DB, submits to PayPal API.
   */
  async function handleSendNow() {
    setSending(true);
    setToast(null);
    try {
      const res = await fetch("/api/payouts/create", { method: "POST" });
      const data = (await res.json()) as PayoutCreateResponse;
      if (!res.ok || !data.success) {
        showToast(
          "error",
          data.error ?? "Failed to send payouts. Check the Payouts page for details."
        );
        return;
      }
      showToast(
        "success",
        `Payout batch sent to PayPal${data.paypalBatchId ? ` (${data.paypalBatchId})` : ""}.`
      );
      router.refresh();
    } catch {
      showToast("error", "Something went wrong sending payouts.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Platform fee ────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Platform Fee
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          The percentage SuperHeroCPR retains from each payment. Instructors receive the
          remainder. This is locked in at the time each earning is recorded; changing
          it here does not retroactively change existing earnings.
        </p>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
          <div className="flex items-center gap-3 max-w-xs">
            <label
              htmlFor="platform-fee"
              className="text-sm font-medium text-gray-700 dark:text-gray-300 shrink-0"
            >
              SuperHeroCPR keeps
            </label>
            <div className="relative flex items-center">
              <input
                id="platform-fee"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={feePercent}
                onChange={(e) => setFeePercent(e.target.value)}
                className={`${inputCls} w-24 pr-7 text-right`}
                aria-label="Platform fee percentage"
              />
              <span className="absolute right-3 text-sm text-gray-500 pointer-events-none">%</span>
            </div>
          </div>
          <MarginReadout feePercent={parseFloat(feePercent)} />
        </div>
      </div>

      {/* ── Payout trigger ──────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          When to Pay Instructors
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Choose how often pending earnings are sent to instructors via PayPal Payouts.
        </p>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Payout trigger mode">
          {TRIGGER_OPTIONS.map((opt) => {
            const selected = trigger === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTrigger(opt.value)}
                className={`text-left rounded-lg border p-4 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  selected
                    ? "border-red-500 bg-red-50 dark:bg-red-950/30 dark:border-red-400"
                    : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 hover:border-gray-300"
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  {opt.icon}
                  <span className={`text-sm font-semibold ${selected ? "text-red-700 dark:text-red-300" : "text-gray-900 dark:text-white"}`}>
                    {opt.label}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {opt.description}
                </p>
              </button>
            );
          })}
        </div>
        <BatchingCostNote upcoming={upcoming} />
      </div>

      {/* ── Schedule interval (only shown when trigger = scheduled) ──────── */}
      {trigger === "scheduled" && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            Payout Schedule
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Payouts will be sent automatically on this interval. The cron job runs at
            5:00 AM UTC; make sure migration 0021 is applied to your Supabase project
            to activate it.
          </p>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Payout schedule interval">
            {SCHEDULE_OPTIONS.map((opt) => {
              const selected = schedule === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSchedule(opt.value)}
                  className={`text-left rounded-lg border p-4 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    selected
                      ? "border-red-500 bg-red-50 dark:bg-red-950/30 dark:border-red-400"
                      : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 hover:border-gray-300"
                  }`}
                >
                  <p className={`text-sm font-semibold ${selected ? "text-red-700 dark:text-red-300" : "text-gray-900 dark:text-white"}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {opt.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Save settings ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>

      {/* ── Manual send ─────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Send Payouts Now
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Immediately disburse all pending eligible earnings to instructors via PayPal
          Payouts, regardless of the trigger mode above. Only instructors with a saved
          payout email will receive funds. You can also send payouts from the{" "}
          <a href="/admin/payouts" className="text-red-600 hover:underline">Payouts page</a>.
        </p>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
          <button
            type="button"
            onClick={handleSendNow}
            disabled={sending}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {sending ? "Sending…" : "Send Payouts Now"}
          </button>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
            This creates one PayPal Payouts batch grouping all instructors with pending
            earnings. PayPal accepting the batch is not confirmation that it was delivered;
            track the outcome in Payout history below.
          </p>
        </div>
      </div>

      {/* ── Upcoming payouts ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Upcoming Payouts
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Who is owed what right now, which classes the money came from, and what
          SuperHeroCPR actually keeps once PayPal has taken its cut on both ends.
        </p>
        <UpcomingPayoutsPanel data={upcoming} />
      </div>

      {/* ── Payout history ───────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Payout History
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Every payout batch and what PayPal did with it. If PayPal denies a payout after
          accepting it, mark it denied here to put the earnings back in the queue, then resend.
        </p>
        <PayoutHistoryPanel batches={history} />
      </div>

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border p-4 shadow-lg flex items-start gap-3 ${
            toast.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <p className="text-sm font-medium">{toast.message}</p>
        </div>
      )}
    </div>
  );
}
