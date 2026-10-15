"use client";

/**
 * UpcomingPayoutsPanel: who is owed what, from which classes, and what the
 * platform actually keeps after PayPal.
 * Read-only; sending is triggered from the parent page's action buttons.
 * Used by: app/(admin)/admin/payouts/page.tsx and
 *          app/(admin)/admin/settings/_components/PayoutSettingsPanel.tsx
 */

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  GraduationCap,
  Wallet,
} from "lucide-react";
import { formatCurrency } from "@/lib/invoice-utils";
import { describePayoutFeeModel } from "@/lib/payout-fees";
import {
  allEarningIds,
  groupEarningIds,
  selectionState,
  toggleIds,
  type PayoutSelection,
  type SelectionState,
} from "@/lib/payout-selection";
import type {
  PayoutFeeModel,
  PayoutRevenueTotals,
  UpcomingPayoutGroup,
  UpcomingPayoutsData,
} from "@/types/payouts";

interface UpcomingPayoutsPanelProps {
  data: UpcomingPayoutsData;
  /**
   * When given, the payable-now table shows checkboxes so the admin can choose
   * which instructors and classes to pay. Omit for a read-only view.
   */
  selection?: PayoutSelection;
}

/**
 * A checkbox that can show "some selected" (the dash state). Used for instructors
 * and the select-all header, which cover several classes at once.
 */
function TriStateCheckbox({
  state,
  onChange,
  label,
}: {
  state: SelectionState;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "all"}
      onChange={onChange}
      aria-label={label}
      className="h-4 w-4 cursor-pointer rounded border-gray-300 text-red-600 focus:ring-red-500"
    />
  );
}

/** Formats a class session date compactly, or returns null when there is none. */
function formatSessionDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** One figure in the revenue summary strip. */
function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "positive" | "warning" | "cost";
}) {
  const valueTone =
    tone === "positive"
      ? "text-green-700"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "cost"
          ? "text-red-700"
          : "text-gray-900";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1.5 text-xl font-bold ${valueTone}`}>{value}</p>
      {hint ? (
        <p className="mt-1 text-[11px] leading-snug text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * The money summary for everything currently payable.
 * Measured PayPal fees and estimated ones are labelled separately: the outbound
 * fee cannot be known until the payout is actually sent.
 */
function RevenueStrip({
  totals,
  feeModel,
}: {
  totals: PayoutRevenueTotals;
  feeModel: PayoutFeeModel;
}) {
  const totalFees = totals.inboundPayPalFees + totals.estimatedPayoutFees;
  const partial = totals.feeUntrackedCount > 0;

  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Charged to customers"
          value={formatCurrency(totals.grossCollected)}
          hint={`${totals.earningCount} payment${totals.earningCount === 1 ? "" : "s"} in this payout, before PayPal fees`}
        />
        <StatTile
          label="Deposited to PayPal"
          value={formatCurrency(totals.depositedAmount)}
          hint={`After ${formatCurrency(totals.inboundPayPalFees)} collection fees${partial ? "*" : ""}`}
        />
        <StatTile
          label="To instructors"
          value={formatCurrency(totals.instructorTotal)}
          hint="Their share of the above"
        />
        <StatTile
          label="SuperHeroCPR cut"
          value={formatCurrency(totals.platformCut)}
          hint="Before PayPal fees"
        />
        <StatTile
          label="PayPal fees"
          value={formatCurrency(totalFees)}
          tone="cost"
          hint={`${formatCurrency(totals.inboundPayPalFees)} charged to collect${partial ? "*" : ""} + ~${formatCurrency(totals.estimatedPayoutFees)} to send`}
        />
        <StatTile
          label="Real net (estimated)"
          value={formatCurrency(totals.estimatedNet)}
          tone={totals.estimatedNet >= 0 ? "positive" : "cost"}
          hint="What SuperHeroCPR actually keeps"
        />
      </div>

      <p className="mt-2 text-[11px] leading-snug text-gray-500">
        Payout fees are estimated at {describePayoutFeeModel(feeModel)}. SuperHeroCPR pays
        this fee, so instructors receive the full payout amount. PayPal only charges it when
        a payout is delivered, not when one is denied.
      </p>

      {partial ? (
        <p className="mt-2 text-[11px] leading-snug text-gray-500">
          * {totals.feeUntrackedCount} of {totals.earningCount} payments have no PayPal fee
          recorded yet, so the collection fee above covers only the {totals.feeTrackedCount}
          that do. This is usually a PayPal invoice whose fee PayPal has not reported (it can
          take a few hours); it fills in automatically. Until then, the deposited amount and
          real net are slightly optimistic.
        </p>
      ) : null}
    </div>
  );
}

/** An expandable instructor row showing the classes behind their payout. */
function InstructorRow({
  group,
  expanded,
  onToggle,
  showPayoutEmail,
  selection,
}: {
  group: UpcomingPayoutGroup;
  expanded: boolean;
  onToggle: () => void;
  showPayoutEmail: boolean;
  selection?: PayoutSelection;
}) {
  const groupIds = groupEarningIds(group);
  return (
    <>
      <tr className="hover:bg-gray-50">
        {selection ? (
          <td className="w-10 px-4 py-3">
            <TriStateCheckbox
              state={selectionState(groupIds, selection.selected)}
              onChange={() => selection.onChange(toggleIds(selection.selected, groupIds))}
              label={`Pay ${group.instructorName}`}
            />
          </td>
        ) : null}
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex items-start gap-2 text-left"
          >
            {expanded ? (
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            ) : (
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            )}
            <span>
              <span className="block font-medium text-gray-900">
                {group.instructorName}
              </span>
              <span className="block text-xs text-gray-500">
                {group.instructorEmail}
              </span>
            </span>
          </button>
        </td>
        {showPayoutEmail ? (
          <td className="px-4 py-3 text-sm">
            {group.paypalPayoutEmail ? (
              <span className="text-gray-700">{group.paypalPayoutEmail}</span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                No payout email saved
              </span>
            )}
          </td>
        ) : null}
        <td className="px-4 py-3 text-right text-sm text-gray-500">
          {group.sources.length}
        </td>
        <td className="px-4 py-3 text-right text-sm text-gray-700">
          {formatCurrency(group.grossAmount)}
        </td>
        <td className="px-4 py-3 text-right text-sm text-gray-700">
          {formatCurrency(group.platformFeeAmount)}
        </td>
        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
          {formatCurrency(group.instructorAmount)}
        </td>
        <td className="px-4 py-3 text-right text-sm text-gray-600">
          ~{formatCurrency(group.estimatedPayoutFee)}
        </td>
      </tr>

      {expanded
        ? group.sources.map((source) => {
            const sessionDate = formatSessionDate(source.sessionDate);
            return (
              <tr key={source.key} className="bg-gray-50/70">
                {selection ? (
                  <td className="w-10 px-4 py-2.5">
                    <TriStateCheckbox
                      state={selectionState(source.earningIds, selection.selected)}
                      onChange={() =>
                        selection.onChange(toggleIds(selection.selected, source.earningIds))
                      }
                      label={`Pay ${source.label} for ${group.instructorName}`}
                    />
                  </td>
                ) : null}
                <td className="py-2.5 pl-10 pr-4">
                  <span className="flex items-start gap-2">
                    {source.kind === "session" ? (
                      <GraduationCap
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400"
                        aria-hidden="true"
                      />
                    ) : (
                      <FileText
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400"
                        aria-hidden="true"
                      />
                    )}
                    <span>
                      <span className="block text-sm text-gray-700">
                        {source.label}
                      </span>
                      {sessionDate || source.detail ? (
                        <span className="block text-xs text-gray-500">
                          {[sessionDate, source.detail].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-500">
                  {source.kind === "session"
                    ? `${source.soldCount} sold`
                    : `${source.soldCount} payment${source.soldCount === 1 ? "" : "s"}`}
                </td>
                <td className="px-4 py-2.5" />
                <td className="px-4 py-2.5 text-right text-xs text-gray-600">
                  {formatCurrency(source.grossAmount)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-gray-600">
                  {formatCurrency(source.platformFeeAmount)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs font-medium text-gray-700">
                  {formatCurrency(source.instructorAmount)}
                </td>
                <td className="px-4 py-2.5" />
              </tr>
            );
          })
        : null}
    </>
  );
}

/** A titled bucket of instructor payouts with its own table. */
function BucketSection({
  title,
  description,
  total,
  groups,
  icon,
  accentClass,
  emptyMessage,
  selection,
}: {
  title: string;
  description: string;
  total: number;
  groups: UpcomingPayoutGroup[];
  icon: React.ReactNode;
  accentClass: string;
  emptyMessage: string;
  /** Present only for the payable bucket; other buckets cannot be paid yet. */
  selection?: PayoutSelection;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggle(instructorId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(instructorId)) next.delete(instructorId);
      else next.add(instructorId);
      return next;
    });
  }

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <span className={accentClass}>{icon}</span>
            {title}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {groups.length}
            </span>
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">{description}</p>
        </div>
        <p className={`text-lg font-bold ${accentClass}`}>{formatCurrency(total)}</p>
      </div>

      {groups.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">
          {emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                {selection ? (
                  <th className="w-10 px-4 py-2.5">
                    <TriStateCheckbox
                      state={selectionState(allEarningIds(groups), selection.selected)}
                      onChange={() =>
                        selection.onChange(toggleIds(selection.selected, allEarningIds(groups)))
                      }
                      label="Select every instructor"
                    />
                  </th>
                ) : null}
                <th className="px-4 py-2.5">Instructor</th>
                <th className="px-4 py-2.5">PayPal email</th>
                <th className="px-4 py-2.5 text-right">Classes</th>
                <th className="px-4 py-2.5 text-right">Gross</th>
                <th className="px-4 py-2.5 text-right">Cut</th>
                <th className="px-4 py-2.5 text-right">Payout</th>
                <th
                  className="px-4 py-2.5 text-right"
                  title="Estimated PayPal fee to send this payout. SuperHeroCPR pays it; the instructor receives the full payout amount."
                >
                  Send fee (est.)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groups.map((group) => (
                <InstructorRow
                  key={group.instructorId}
                  group={group}
                  expanded={expandedIds.has(group.instructorId)}
                  onToggle={() => toggle(group.instructorId)}
                  showPayoutEmail
                  selection={selection}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Renders upcoming instructor payouts split into payable, blocked, and in-flight
 * buckets, with a revenue summary showing real margin after PayPal fees.
 * All state is local expansion state; data is fetched server-side.
 */
export default function UpcomingPayoutsPanel({ data, selection }: UpcomingPayoutsPanelProps) {
  const hasAnything =
    data.payableNow.length > 0 || data.blocked.length > 0 || data.inFlight.length > 0;

  if (!hasAnything) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <Wallet className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-gray-900">
          No instructor earnings are waiting
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Earnings appear here as soon as a class booking or invoice is paid.
        </p>
      </div>
    );
  }

  return (
    <div>
      {data.payableNow.length > 0 ? <RevenueStrip totals={data.payableTotals} feeModel={data.payoutFeeModel} /> : null}

      <BucketSection
        title="Payable now"
        description="Ready to send. These instructors have a PayPal payout email saved. Tick the instructors or classes to pay, or expand a row to see which classes the money came from."
        total={data.payableTotals.instructorTotal}
        groups={data.payableNow}
        icon={<Wallet className="h-4 w-4" aria-hidden="true" />}
        accentClass="text-green-700"
        emptyMessage="Nothing is ready to pay right now."
        selection={selection}
      />

      {data.blocked.length > 0 ? (
        <BucketSection
          title="Waiting on payout setup"
          description="These earnings cannot be sent until the instructor saves a PayPal payout email on their profile. They are held, not lost, and will be included automatically once the email is added."
          total={data.blockedTotal}
          groups={data.blocked}
          icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          accentClass="text-amber-700"
          emptyMessage="Every instructor with earnings has a payout email saved."
        />
      ) : null}

      {data.inFlight.length > 0 ? (
        <BucketSection
          title="In flight at PayPal"
          description="Already sent to PayPal and awaiting confirmation. PayPal can still deny a payout at this stage and return the funds, so these are not counted as paid until confirmed."
          total={data.inFlightTotal}
          groups={data.inFlight}
          icon={<Clock className="h-4 w-4" aria-hidden="true" />}
          accentClass="text-blue-700"
          emptyMessage="Nothing is currently in flight."
        />
      ) : null}
    </div>
  );
}

/** Re-exported so pages can pass server-fetched data without a second import. */
export type { UpcomingPayoutsData };
