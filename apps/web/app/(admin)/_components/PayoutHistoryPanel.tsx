"use client";

/**
 * PayoutHistoryPanel: every payout batch the system has attempted, what PayPal
 * did with it, and the recovery actions available.
 *
 * The central idea: a batch PayPal accepted is shown as "assumed complete", never
 * "paid". PayPal can deny a batch hours after accepting it and return the funds
 * without telling the app through the API, so this panel lets a super_admin
 * record that denial and resend, while making it hard to do so by accident:
 * marking a delivered payout denied is what allows a double payment.
 *
 * When PayPal denies a payout and the instructor is paid by hand instead, a
 * super_admin records that here ("Paid manually"), which marks the earnings paid
 * so they are never sent again. A mistaken record can be undone.
 *
 * Used by: app/(admin)/admin/payouts/page.tsx and
 *          app/(admin)/admin/settings/_components/PayoutSettingsPanel.tsx
 */

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CornerUpLeft,
  HelpCircle,
  RefreshCw,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/invoice-utils";
import { formatManualPaidOn } from "@/lib/payout-manual";
import {
  MANUAL_PAYOUT_METHODS,
  MANUAL_PAYOUT_METHOD_LABELS,
  type ManualPayoutMethod,
  type PayoutBatchStatus,
  type PayoutHistoryBatch,
  type PayoutHistoryItem,
  type PayoutItemStatus,
} from "@/types/payouts";

interface PayoutHistoryPanelProps {
  batches: PayoutHistoryBatch[];
}

/** Preset denial reasons, matching the causes PayPal actually cites. */
const DENIAL_REASONS = [
  "Insufficient PayPal balance when the batch was processed",
  "PayPal risk or compliance review",
  "Account limitation or verification hold",
  "Recipient account problem",
  "Other (explained below)",
];

/** Hours after which an unconfirmed batch is worth chasing. */
const STALE_ASSUMED_HOURS = 24;

/** Badge appearance and plain-English label per batch status. */
const BATCH_STATUS_BADGES: Record<
  PayoutBatchStatus,
  { label: string; classes: string; icon: React.ReactNode }
> = {
  pending: {
    label: "Not sent",
    classes: "bg-gray-100 text-gray-700",
    icon: <Clock className="h-3 w-3" aria-hidden="true" />,
  },
  assumed_complete: {
    label: "Assumed complete",
    classes: "bg-blue-100 text-blue-800",
    icon: <HelpCircle className="h-3 w-3" aria-hidden="true" />,
  },
  completed: {
    label: "Confirmed paid",
    classes: "bg-green-100 text-green-800",
    icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
  },
  denied: {
    label: "Denied by PayPal",
    classes: "bg-red-100 text-red-800",
    icon: <Ban className="h-3 w-3" aria-hidden="true" />,
  },
  failed: {
    label: "Failed to send",
    classes: "bg-orange-100 text-orange-800",
    icon: <X className="h-3 w-3" aria-hidden="true" />,
  },
  needs_review: {
    label: "Needs review",
    classes: "bg-amber-100 text-amber-900",
    icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
  },
  manually_paid: {
    label: "Paid manually",
    classes: "bg-green-100 text-green-800",
    icon: <Banknote className="h-3 w-3" aria-hidden="true" />,
  },
};

/**
 * Badge for a finished batch where some instructors were paid and others were
 * returned by PayPal. The stored batch status is `completed` in that case, which
 * on its own would read "Confirmed paid" beside a note that money came back.
 */
const PARTLY_PAID_BADGE = {
  label: "Partly paid",
  classes: "bg-amber-100 text-amber-900",
  icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
};

/** Badge appearance per payout item status. */
const ITEM_STATUS_BADGES: Record<PayoutItemStatus, { label: string; classes: string }> = {
  pending: { label: "Not sent", classes: "bg-gray-100 text-gray-700" },
  assumed_complete: { label: "Assumed sent", classes: "bg-blue-100 text-blue-800" },
  completed: { label: "Paid", classes: "bg-green-100 text-green-800" },
  denied: { label: "Returned", classes: "bg-red-100 text-red-800" },
  failed: { label: "Failed", classes: "bg-orange-100 text-orange-800" },
  needs_review: { label: "Needs review", classes: "bg-amber-100 text-amber-900" },
  unclaimed: { label: "Unclaimed", classes: "bg-purple-100 text-purple-800" },
  manually_paid: { label: "Paid manually", classes: "bg-green-100 text-green-800" },
};

/** Response shape shared by the payout action routes. */
interface PayoutActionResponse {
  success: boolean;
  error?: string;
  message?: string;
  syncedItems?: number;
  deniedBatches?: number;
  releasedItems?: number;
  failedBatches?: number;
  confirmedByPayPal?: boolean;
}

/** Type guard for payout action responses. */
function isActionResponse(value: unknown): value is PayoutActionResponse {
  return typeof value === "object" && value !== null && "success" in value;
}

/** Hours elapsed since an ISO timestamp, or null when absent. */
function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const elapsed = Date.now() - new Date(iso).getTime();
  return Number.isFinite(elapsed) ? elapsed / 3_600_000 : null;
}

/** Renders "3 hours"/"2 days" for an elapsed hour count. */
function formatElapsed(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 24) {
    const rounded = Math.round(hours);
    return `${rounded} hour${rounded === 1 ? "" : "s"}`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** The typed-confirmation modal shown before a denial is recorded. */
function DenyDialog({
  target,
  onCancel,
  onConfirm,
  submitting,
}: {
  target: {
    batchId: string;
    senderBatchId: string;
    itemId?: string;
    instructorName?: string;
    amount: number;
  };
  onCancel: () => void;
  onConfirm: (reason: string, confirmSenderBatchId: string) => void;
  submitting: boolean;
}) {
  const [preset, setPreset] = useState(DENIAL_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [typed, setTyped] = useState("");

  const scopeLabel = target.itemId
    ? `${target.instructorName ?? "this instructor"}'s ${formatCurrency(target.amount)} payout`
    : `this entire ${formatCurrency(target.amount)} batch`;

  const confirmationMatches = typed.trim() === target.senderBatchId;
  const reason = detail.trim() ? `${preset}: ${detail.trim()}` : preset;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Ban className="h-5 w-5 text-red-600" aria-hidden="true" />
          Mark as denied by PayPal
        </h3>

        <p className="mt-3 text-sm text-gray-600">
          This records that PayPal returned the money for {scopeLabel}. The earnings go back
          into the payable queue so they can be sent again.
        </p>

        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="flex items-start gap-2 text-xs text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Only do this after confirming in PayPal that the funds came back. If the payout
              actually went through, marking it denied lets the same money be sent a second
              time, and it cannot be recovered. PayPal will be checked once more before this
              is saved, and the action is refused if PayPal reports the payout succeeded.
            </span>
          </p>
        </div>

        <div className="mt-4">
          <label
            htmlFor="denial-reason"
            className="block text-sm font-medium text-gray-700"
          >
            Why did PayPal deny it?
          </label>
          <select
            id="denial-reason"
            value={preset}
            onChange={(event) => setPreset(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {DENIAL_REASONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3">
          <label
            htmlFor="denial-detail"
            className="block text-sm font-medium text-gray-700"
          >
            Details <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <textarea
            id="denial-detail"
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            rows={2}
            placeholder="What PayPal's notification or dashboard said"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        <div className="mt-3">
          <label
            htmlFor="denial-confirm"
            className="block text-sm font-medium text-gray-700"
          >
            Type the batch id to confirm
          </label>
          <p className="mt-1 font-mono text-xs text-gray-500">
            {target.senderBatchId}
          </p>
          <input
            id="denial-confirm"
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason, typed.trim())}
            disabled={submitting || !confirmationMatches}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? "Recording…" : "Mark denied"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Today's date in the viewer's own timezone as YYYY-MM-DD, for the date input default. */
function todayLocalIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** What the manual payment and undo dialogs need to know about their target item. */
interface ManualTarget {
  batchId: string;
  senderBatchId: string;
  itemId: string;
  instructorName: string;
  amount: number;
}

/** Fields collected by the manual payment dialog. */
interface ManualPaymentFields {
  method: ManualPayoutMethod;
  reference: string;
  paidOn: string;
  amount: string;
  note: string;
  confirmSenderBatchId: string;
}

/**
 * Dialog for recording that an instructor was paid outside PayPal.
 * Requires the amount and the batch id to be typed back, because recording money
 * as paid that was not actually sent leaves the instructor unpaid with no alert.
 */
function ManualPaymentDialog({
  target,
  onCancel,
  onConfirm,
  submitting,
}: {
  target: ManualTarget;
  onCancel: () => void;
  onConfirm: (fields: ManualPaymentFields) => void;
  submitting: boolean;
}) {
  const [method, setMethod] = useState<ManualPayoutMethod>("zelle");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(todayLocalIso());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");

  const amountMatches = Number(amount) === target.amount && amount.trim() !== "";
  const confirmationMatches = typed.trim() === target.senderBatchId;
  const ready =
    amountMatches && confirmationMatches && reference.trim().length > 0 && paidOn.length > 0;

  const inputClasses =
    "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-600";
  const labelClasses = "block text-sm font-medium text-gray-700";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Banknote className="h-5 w-5 text-green-600" aria-hidden="true" />
          Record a manual payment
        </h3>

        <p className="mt-3 text-sm text-gray-600">
          Use this when you paid {target.instructorName} yourself because PayPal denied the
          payout. Their earnings are marked paid and will not be sent again. You owe them{" "}
          <strong>{formatCurrency(target.amount)}</strong> for this payout.
        </p>

        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-start gap-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Only record this after the money has actually been sent. The instructor is
              emailed that they were paid. PayPal is checked once more before this is saved,
              and it is refused if PayPal says the payout went through or is still moving.
            </span>
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="manual-method" className={labelClasses}>
              How did you pay them?
            </label>
            <select
              id="manual-method"
              value={method}
              onChange={(event) => setMethod(event.target.value as ManualPayoutMethod)}
              className={inputClasses}
            >
              {MANUAL_PAYOUT_METHODS.map((option) => (
                <option key={option} value={option}>
                  {MANUAL_PAYOUT_METHOD_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="manual-paid-on" className={labelClasses}>
              Date sent
            </label>
            <input
              id="manual-paid-on"
              type="date"
              value={paidOn}
              max={todayLocalIso()}
              onChange={(event) => setPaidOn(event.target.value)}
              className={inputClasses}
            />
          </div>
        </div>

        <div className="mt-3">
          <label htmlFor="manual-reference" className={labelClasses}>
            Reference
          </label>
          <input
            id="manual-reference"
            type="text"
            value={reference}
            maxLength={200}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Confirmation number, check number, or a short description"
            className={inputClasses}
          />
        </div>

        <div className="mt-3">
          <label htmlFor="manual-amount" className={labelClasses}>
            Amount you paid
          </label>
          <input
            id="manual-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={`Type ${target.amount.toFixed(2)} to confirm`}
            autoComplete="off"
            className={inputClasses}
          />
          {amount.trim() !== "" && !amountMatches ? (
            <p className="mt-1 text-xs text-red-700">
              This must equal the amount owed ({formatCurrency(target.amount)}).
            </p>
          ) : null}
        </div>

        <div className="mt-3">
          <label htmlFor="manual-note" className={labelClasses}>
            Note <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <textarea
            id="manual-note"
            value={note}
            rows={2}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            className={inputClasses}
          />
        </div>

        <div className="mt-3">
          <label htmlFor="manual-confirm" className={labelClasses}>
            Type the batch id to confirm
          </label>
          <p className="mt-1 font-mono text-xs text-gray-500">
            {target.senderBatchId}
          </p>
          <input
            id="manual-confirm"
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={`${inputClasses} font-mono`}
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm({
                method,
                reference: reference.trim(),
                paidOn,
                amount: amount.trim(),
                note: note.trim(),
                confirmSenderBatchId: typed.trim(),
              })
            }
            disabled={submitting || !ready}
            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-800 disabled:opacity-50"
          >
            {submitting ? "Recording…" : "Record payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Dialog for undoing a manual payment record that was made by mistake. */
function UndoManualDialog({
  target,
  onCancel,
  onConfirm,
  submitting,
}: {
  target: ManualTarget;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  submitting: boolean;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Undo2 className="h-5 w-5 text-gray-600" aria-hidden="true" />
          Undo manual payment
        </h3>
        <p className="mt-3 text-sm text-gray-600">
          This puts {target.instructorName}&apos;s {formatCurrency(target.amount)} back in the
          payable queue, so it will go out again with the next payout unless you record it
          again. The instructor is not emailed about an undo, so tell them directly if needed.
        </p>
        <label
          htmlFor="undo-reason"
          className="mt-4 block text-sm font-medium text-gray-700"
        >
          Why are you undoing it?
        </label>
        <textarea
          id="undo-reason"
          value={reason}
          rows={2}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-gray-500"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={submitting || reason.trim().length === 0}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
          >
            {submitting ? "Undoing…" : "Undo payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One payout item line inside an expanded batch. */
function ItemRow({
  item,
  canDeny,
  onDeny,
  canSettle,
  onSettle,
  onUndoManual,
}: {
  item: PayoutHistoryItem;
  canDeny: boolean;
  onDeny: () => void;
  canSettle: boolean;
  onSettle: () => void;
  onUndoManual: () => void;
}) {
  const badge = ITEM_STATUS_BADGES[item.status] ?? ITEM_STATUS_BADGES.pending;

  return (
    <tr className="bg-gray-50/70">
      <td className="py-2.5 pl-10 pr-4">
        <span className="block text-sm text-gray-700">
          {item.instructorName}
        </span>
        <span className="block text-xs text-gray-500">
          {item.recipientEmail}
        </span>
        {item.status === "unclaimed" && item.unclaimedExpiresAt ? (
          <span className="mt-0.5 block text-xs text-purple-700">
            Not claimed yet; PayPal returns it on {formatDateTime(item.unclaimedExpiresAt)}
          </span>
        ) : null}
        {item.errorMessage ? (
          <span className="mt-0.5 block text-xs text-red-700">
            {item.errorMessage}
          </span>
        ) : null}
        {item.status === "manually_paid" && item.manualPayment ? (
          <span className="mt-0.5 block text-xs text-green-800">
            Paid by {MANUAL_PAYOUT_METHOD_LABELS[item.manualPayment.method]} on{" "}
            {formatManualPaidOn(item.manualPayment.paidOn)}, ref {item.manualPayment.reference}
            {item.manualPayment.recordedByName
              ? `, recorded by ${item.manualPayment.recordedByName}`
              : ""}
            {item.manualPayment.note ? `. ${item.manualPayment.note}` : ""}
          </span>
        ) : null}
        {item.status !== "manually_paid" && item.manualPayment?.voidedAt ? (
          <span className="mt-0.5 block text-xs text-gray-500">
            An earlier manual payment ({MANUAL_PAYOUT_METHOD_LABELS[item.manualPayment.method]},
            ref {item.manualPayment.reference}) was undone
            {item.manualPayment.voidReason ? `: ${item.manualPayment.voidReason}` : ""}
          </span>
        ) : null}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.classes}`}
        >
          {badge.label}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-gray-600">
        {item.paypalFeeAmount === null ? "-" : formatCurrency(item.paypalFeeAmount)}
      </td>
      <td className="px-4 py-2.5 text-right text-xs font-medium text-gray-700">
        {formatCurrency(item.amount)}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex flex-wrap justify-end gap-1.5">
          {canDeny ? (
            <button
              type="button"
              onClick={onDeny}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-white"
            >
              Mark denied
            </button>
          ) : null}
          {canSettle ? (
            <button
              type="button"
              onClick={onSettle}
              className="inline-flex items-center gap-1 rounded-md bg-green-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-green-800"
            >
              <Banknote className="h-3 w-3" aria-hidden="true" />
              Paid manually
            </button>
          ) : null}
          {item.status === "manually_paid" ? (
            <button
              type="button"
              onClick={onUndoManual}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-white"
            >
              <Undo2 className="h-3 w-3" aria-hidden="true" />
              Undo
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/**
 * Payout batch history with denial and resend actions.
 * Manages expansion, the deny dialog, and per-action loading state; refreshes
 * server data after every mutation.
 */
export default function PayoutHistoryPanel({ batches }: PayoutHistoryPanelProps) {
  const router = useRouter();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [submittingDenial, setSubmittingDenial] = useState(false);
  const [denyTarget, setDenyTarget] = useState<{
    batchId: string;
    senderBatchId: string;
    itemId?: string;
    instructorName?: string;
    amount: number;
  } | null>(null);
  const [manualTarget, setManualTarget] = useState<ManualTarget | null>(null);
  const [undoTarget, setUndoTarget] = useState<ManualTarget | null>(null);
  const [submittingManual, setSubmittingManual] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  function toggle(batchId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }

  /**
   * Posts to a payout action route and reports the outcome.
   * @param url - API route to call.
   * @param body - JSON payload.
   * @param fallbackError - Message shown when the route gives none.
   * @returns True when the action succeeded.
   */
  async function postAction(
    url: string,
    body: Record<string, unknown>,
    fallbackError: string
  ): Promise<boolean> {
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed: unknown = await response.json().catch(() => null);

      if (!response.ok || !isActionResponse(parsed) || !parsed.success) {
        setMessage({
          type: "error",
          text: isActionResponse(parsed) && parsed.error ? parsed.error : fallbackError,
        });
        return false;
      }

      setMessage({
        type: "success",
        text: parsed.message ?? "Done.",
      });
      router.refresh();
      return true;
    } catch {
      setMessage({ type: "error", text: fallbackError });
      return false;
    }
  }

  /** Re-checks every unresolved batch against PayPal. */
  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/payouts/sync", { method: "POST" });
      const parsed: unknown = await response.json().catch(() => null);

      if (!response.ok || !isActionResponse(parsed) || !parsed.success) {
        setMessage({
          type: "error",
          text:
            isActionResponse(parsed) && parsed.error
              ? parsed.error
              : "Failed to sync payout status.",
        });
        return;
      }

      const denied = parsed.deniedBatches ?? 0;
      const failed = parsed.failedBatches ?? 0;
      const synced = parsed.syncedItems ?? 0;

      let text: string;
      if (denied > 0) {
        text = `PayPal denied ${denied} batch(es). ${parsed.releasedItems ?? 0} payout(s) went back into the payable queue.`;
        if (failed > 0) text += ` ${failed} other batch(es) could not be reached and were skipped.`;
      } else if (failed > 0) {
        text =
          synced > 0
            ? `Checked ${synced} payout item(s). ${failed} batch(es) could not be reached and were skipped. Try again shortly.`
            : `Could not reach PayPal for ${failed} batch(es); nothing was confirmed. Try again shortly.`;
      } else {
        text = `Checked ${synced} payout item(s) against PayPal. No denials found.`;
      }

      setMessage({ type: denied > 0 || failed > 0 ? "error" : "success", text });
      router.refresh();
    } catch {
      setMessage({ type: "error", text: "Something went wrong syncing payouts." });
    } finally {
      setSyncing(false);
    }
  }

  /** Records a denial for the current dialog target. */
  async function handleConfirmDenial(reason: string, confirmSenderBatchId: string) {
    if (!denyTarget) return;
    setSubmittingDenial(true);
    const ok = await postAction(
      "/api/payouts/deny",
      {
        batchId: denyTarget.batchId,
        itemId: denyTarget.itemId,
        reason,
        confirmSenderBatchId,
      },
      "Failed to record the denial."
    );
    setSubmittingDenial(false);
    if (ok) setDenyTarget(null);
  }

  /** Records the manual payment collected by the dialog. */
  async function handleConfirmManualPayment(fields: ManualPaymentFields) {
    if (!manualTarget) return;
    setSubmittingManual(true);
    const ok = await postAction(
      "/api/payouts/manual-settle",
      {
        batchId: manualTarget.batchId,
        itemId: manualTarget.itemId,
        method: fields.method,
        reference: fields.reference,
        paidOn: fields.paidOn,
        amount: fields.amount,
        note: fields.note,
        confirmSenderBatchId: fields.confirmSenderBatchId,
      },
      "Failed to record the manual payment."
    );
    setSubmittingManual(false);
    if (ok) setManualTarget(null);
  }

  /** Undoes a manual payment record. */
  async function handleConfirmUndo(reason: string) {
    if (!undoTarget) return;
    setSubmittingManual(true);
    const ok = await postAction(
      "/api/payouts/manual-void",
      { itemId: undoTarget.itemId, reason },
      "Failed to undo the manual payment."
    );
    setSubmittingManual(false);
    if (ok) setUndoTarget(null);
  }

  /** Resends a denied or failed batch as a new linked batch. */
  async function handleResend(batch: PayoutHistoryBatch) {
    const confirmed = window.confirm(
      `Resend ${formatCurrency(batch.totalAmount)} to ${batch.itemCount} instructor(s)? This creates a new PayPal payout batch.`
    );
    if (!confirmed) return;

    setBusyAction(`resend-${batch.id}`);
    await postAction(
      "/api/payouts/retry",
      { batchId: batch.id },
      "Failed to resend this payout batch."
    );
    setBusyAction(null);
  }

  /** Releases a failed batch that never reached PayPal. */
  async function handleRelease(batch: PayoutHistoryBatch) {
    const confirmed = window.confirm(
      "Release this batch only after confirming in PayPal that no payout was created."
    );
    if (!confirmed) return;

    setBusyAction(`release-${batch.id}`);
    await postAction(
      "/api/payouts/release",
      { batchId: batch.id },
      "Failed to release this payout batch."
    );
    setBusyAction(null);
  }

  const staleCount = batches.filter((batch) => {
    if (batch.status !== "assumed_complete") return false;
    const hours = hoursSince(batch.submittedAt);
    return hours !== null && hours > STALE_ASSUMED_HOURS;
  }).length;

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Payout history
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            &ldquo;Assumed complete&rdquo; means PayPal accepted the batch but has not confirmed
            delivery. PayPal can still deny a payout at that stage and return the money, so if
            that happens, mark the batch or the affected instructor denied and resend it. If you
            paid an instructor yourself instead, expand the batch and use &ldquo;Paid
            manually&rdquo; on their line so they are not paid twice.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
          {syncing ? "Checking PayPal…" : "Sync status"}
        </button>
      </div>

      {message ? (
        <div
          role="status"
          className={`flex items-start gap-2 border-b px-5 py-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{message.text}</span>
        </div>
      ) : null}

      {staleCount > 0 ? (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {staleCount} batch{staleCount === 1 ? "" : "es"} {staleCount === 1 ? "has" : "have"}{" "}
            been unconfirmed for more than {STALE_ASSUMED_HOURS} hours. Run Sync status, or check
            PayPal directly; this is the window where a denial goes unnoticed.
          </span>
        </div>
      ) : null}

      {batches.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">
          No payout batches yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5">Batch</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">PayPal fee</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {batches.map((batch) => {
                // A completed batch that still has returned instructors is only partly paid.
                const partlyPaid =
                  batch.status === "completed" &&
                  batch.items.some((item) => item.status === "denied" || item.status === "failed");
                const badge = partlyPaid
                  ? PARTLY_PAID_BADGE
                  : (BATCH_STATUS_BADGES[batch.status] ?? BATCH_STATUS_BADGES.pending);
                const expanded = expandedIds.has(batch.id);
                const assumedHours =
                  batch.status === "assumed_complete" ? hoursSince(batch.submittedAt) : null;
                const canDeny = ["assumed_complete", "completed", "needs_review"].includes(
                  batch.status
                );
                const canResend = batch.status === "denied" || batch.status === "failed";
                // needs_review is the main case Release exists for: the request may
                // have reached PayPal but the response never did, so its earnings stay
                // locked until a human confirms in PayPal that nothing was created.
                const canRelease =
                  (batch.status === "failed" || batch.status === "needs_review") &&
                  !batch.paypalPayoutBatchId;

                return (
                  <Fragment key={batch.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggle(batch.id)}
                          aria-expanded={expanded}
                          className="flex items-start gap-2 text-left"
                        >
                          {expanded ? (
                            <ChevronDown
                              className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronRight
                              className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
                              aria-hidden="true"
                            />
                          )}
                          <span>
                            <span className="block text-sm text-gray-900">
                              {formatDateTime(batch.createdAt)}
                            </span>
                            <span className="block font-mono text-[11px] text-gray-500">
                              {batch.paypalPayoutBatchId ?? batch.senderBatchId}
                            </span>
                            <span className="block text-xs text-gray-500">
                              {batch.itemCount} instructor{batch.itemCount === 1 ? "" : "s"}
                            </span>
                            {batch.retryOfSenderBatchId ? (
                              <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-blue-700">
                                <CornerUpLeft className="h-3 w-3" aria-hidden="true" />
                                Resend
                                {batch.retryDepth > 1 ? ` #${batch.retryDepth}` : ""} of{" "}
                                <span className="font-mono">{batch.retryOfSenderBatchId}</span>
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.classes}`}
                        >
                          {badge.icon}
                          {badge.label}
                        </span>
                        {assumedHours !== null ? (
                          <span className="mt-1 block text-[11px] text-gray-500">
                            unconfirmed for {formatElapsed(assumedHours)}
                          </span>
                        ) : null}
                        {batch.deniedAt ? (
                          <span className="mt-1 block text-[11px] text-gray-500">
                            {batch.denialSource === "manual"
                              ? `Marked by ${batch.deniedByName ?? "super admin"}`
                              : batch.denialSource === "webhook"
                                ? "Reported by PayPal webhook"
                                : "Found by PayPal sync"}
                          </span>
                        ) : null}
                        {batch.errorMessage ? (
                          <span className="mt-1 block max-w-xs text-[11px] text-red-700">
                            {batch.errorMessage}
                          </span>
                        ) : null}
                      </td>

                      <td className="px-4 py-3 text-right text-sm text-gray-600">
                        {batch.paypalFeeTotal === null
                          ? "-"
                          : formatCurrency(batch.paypalFeeTotal)}
                      </td>

                      <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                        {formatCurrency(batch.totalAmount)}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {canDeny ? (
                            <button
                              type="button"
                              onClick={() =>
                                setDenyTarget({
                                  batchId: batch.id,
                                  senderBatchId: batch.senderBatchId,
                                  amount: batch.totalAmount,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                            >
                              <Ban className="h-3 w-3" aria-hidden="true" />
                              Mark denied
                            </button>
                          ) : null}

                          {canResend ? (
                            <button
                              type="button"
                              onClick={() => handleResend(batch)}
                              disabled={busyAction === `resend-${batch.id}`}
                              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                            >
                              <RotateCcw className="h-3 w-3" aria-hidden="true" />
                              {busyAction === `resend-${batch.id}` ? "Resending…" : "Resend"}
                            </button>
                          ) : null}

                          {canRelease ? (
                            <button
                              type="button"
                              onClick={() => handleRelease(batch)}
                              disabled={busyAction === `release-${batch.id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                            >
                              <Undo2 className="h-3 w-3" aria-hidden="true" />
                              {busyAction === `release-${batch.id}` ? "Releasing…" : "Release"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>

                    {expanded ? (
                      batch.items.length === 0 ? (
                        <tr className="bg-gray-50/70">
                          <td
                            colSpan={5}
                            className="py-3 pl-10 pr-4 text-xs text-gray-500"
                          >
                            No payout items recorded for this batch.
                          </td>
                        </tr>
                      ) : (
                        batch.items.map((item) => (
                          <ItemRow
                            key={item.id}
                            item={item}
                            canDeny={
                              canDeny &&
                              item.status !== "denied" &&
                              item.status !== "failed" &&
                              item.status !== "manually_paid"
                            }
                            canSettle={item.status === "denied" || item.status === "failed"}
                            onSettle={() =>
                              setManualTarget({
                                batchId: batch.id,
                                senderBatchId: batch.senderBatchId,
                                itemId: item.id,
                                instructorName: item.instructorName,
                                amount: item.amount,
                              })
                            }
                            onUndoManual={() =>
                              setUndoTarget({
                                batchId: batch.id,
                                senderBatchId: batch.senderBatchId,
                                itemId: item.id,
                                instructorName: item.instructorName,
                                amount: item.amount,
                              })
                            }
                            onDeny={() =>
                              setDenyTarget({
                                batchId: batch.id,
                                senderBatchId: batch.senderBatchId,
                                itemId: item.id,
                                instructorName: item.instructorName,
                                amount: item.amount,
                              })
                            }
                          />
                        ))
                      )
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {manualTarget ? (
        <ManualPaymentDialog
          target={manualTarget}
          onCancel={() => setManualTarget(null)}
          onConfirm={handleConfirmManualPayment}
          submitting={submittingManual}
        />
      ) : null}

      {undoTarget ? (
        <UndoManualDialog
          target={undoTarget}
          onCancel={() => setUndoTarget(null)}
          onConfirm={handleConfirmUndo}
          submitting={submittingManual}
        />
      ) : null}

      {denyTarget ? (
        <DenyDialog
          target={denyTarget}
          onCancel={() => setDenyTarget(null)}
          onConfirm={handleConfirmDenial}
          submitting={submittingDenial}
        />
      ) : null}
    </section>
  );
}
