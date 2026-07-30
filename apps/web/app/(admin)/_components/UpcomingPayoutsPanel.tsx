"use client";

/**
 * UpcomingPayoutsPanel — who is owed what, from which classes, and what the
 * platform actually keeps after PayPal.
 * Read-only; sending is triggered from the parent page's action buttons.
 * Used by: app/(admin)/admin/payouts/page.tsx and
 *          app/(admin)/admin/settings/_components/PayoutSettingsPanel.tsx
 */

import { useState } from "react";
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
import type {
  PayoutRevenueTotals,
  UpcomingPayoutGroup,
  UpcomingPayoutsData,
} from "@/types/payouts";

interface UpcomingPayoutsPanelProps {
  data: UpcomingPayoutsData;
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
      ? "text-green-700 dark:text-green-400"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "cost"
          ? "text-red-700 dark:text-red-400"
          : "text-gray-900 dark:text-white";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1.5 text-xl font-bold ${valueTone}`}>{value}</p>
      {hint ? (
        <p className="mt-1 text-[11px] leading-snug text-gray-400 dark:text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * The money summary for everything currently payable.
 * Measured PayPal fees and estimated ones are labelled separately — the outbound
 * fee cannot be known until the payout is actually sent.
 */
function RevenueStrip({ totals }: { totals: PayoutRevenueTotals }) {
  const totalFees = totals.inboundPayPalFees + totals.estimatedPayoutFees;
  const partial = totals.feeUntrackedCount > 0;

  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Collected from customers"
          value={formatCurrency(totals.grossCollected)}
          hint={`${totals.earningCount} payment${totals.earningCount === 1 ? "" : "s"} in this payout`}
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

      {partial ? (
        <p className="mt-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
          * {totals.feeUntrackedCount} of {totals.earningCount} payments have no PayPal fee
          recorded — invoices and offline payments do not report one, so the collection fee
          above covers only the {totals.feeTrackedCount} that do. The real net is therefore
          slightly optimistic.
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
}: {
  group: UpcomingPayoutGroup;
  expanded: boolean;
  onToggle: () => void;
  showPayoutEmail: boolean;
}) {
  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
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
              <span className="block font-medium text-gray-900 dark:text-white">
                {group.instructorName}
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {group.instructorEmail}
              </span>
            </span>
          </button>
        </td>
        {showPayoutEmail ? (
          <td className="px-4 py-3 text-sm">
            {group.paypalPayoutEmail ? (
              <span className="text-gray-700 dark:text-gray-300">{group.paypalPayoutEmail}</span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                No payout email saved
              </span>
            )}
          </td>
        ) : null}
        <td className="px-4 py-3 text-right text-sm text-gray-500 dark:text-gray-400">
          {group.sources.length}
        </td>
        <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
          {formatCurrency(group.grossAmount)}
        </td>
        <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
          {formatCurrency(group.platformFeeAmount)}
        </td>
        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-white">
          {formatCurrency(group.instructorAmount)}
        </td>
      </tr>

      {expanded
        ? group.sources.map((source) => {
            const sessionDate = formatSessionDate(source.sessionDate);
            return (
              <tr key={source.key} className="bg-gray-50/70 dark:bg-gray-900/40">
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
                      <span className="block text-sm text-gray-700 dark:text-gray-300">
                        {source.label}
                      </span>
                      {sessionDate || source.detail ? (
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          {[sessionDate, source.detail].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                  {source.kind === "session"
                    ? `${source.soldCount} sold`
                    : `${source.soldCount} payment${source.soldCount === 1 ? "" : "s"}`}
                </td>
                <td className="px-4 py-2.5" />
                <td className="px-4 py-2.5 text-right text-xs text-gray-600 dark:text-gray-400">
                  {formatCurrency(source.grossAmount)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-gray-600 dark:text-gray-400">
                  {formatCurrency(source.platformFeeAmount)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs font-medium text-gray-700 dark:text-gray-300">
                  {formatCurrency(source.instructorAmount)}
                </td>
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
}: {
  title: string;
  description: string;
  total: number;
  groups: UpcomingPayoutGroup[];
  icon: React.ReactNode;
  accentClass: string;
  emptyMessage: string;
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
    <section className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <span className={accentClass}>{icon}</span>
            {title}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {groups.length}
            </span>
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-gray-500 dark:text-gray-400">{description}</p>
        </div>
        <p className={`text-lg font-bold ${accentClass}`}>{formatCurrency(total)}</p>
      </div>

      {groups.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          {emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
              <tr>
                <th className="px-4 py-2.5">Instructor</th>
                <th className="px-4 py-2.5">PayPal email</th>
                <th className="px-4 py-2.5 text-right">Lines</th>
                <th className="px-4 py-2.5 text-right">Gross</th>
                <th className="px-4 py-2.5 text-right">Cut</th>
                <th className="px-4 py-2.5 text-right">Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {groups.map((group) => (
                <InstructorRow
                  key={group.instructorId}
                  group={group}
                  expanded={expandedIds.has(group.instructorId)}
                  onToggle={() => toggle(group.instructorId)}
                  showPayoutEmail
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
export default function UpcomingPayoutsPanel({ data }: UpcomingPayoutsPanelProps) {
  const hasAnything =
    data.payableNow.length > 0 || data.blocked.length > 0 || data.inFlight.length > 0;

  if (!hasAnything) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
        <Wallet className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">
          No instructor earnings are waiting
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Earnings appear here as soon as a class booking or invoice is paid.
        </p>
      </div>
    );
  }

  return (
    <div>
      {data.payableNow.length > 0 ? <RevenueStrip totals={data.payableTotals} /> : null}

      <BucketSection
        title="Payable now"
        description="Ready to send. These instructors have a PayPal payout email saved. Expand a row to see which classes the money came from."
        total={data.payableTotals.instructorTotal}
        groups={data.payableNow}
        icon={<Wallet className="h-4 w-4" aria-hidden="true" />}
        accentClass="text-green-700 dark:text-green-400"
        emptyMessage="Nothing is ready to pay right now."
      />

      {data.blocked.length > 0 ? (
        <BucketSection
          title="Waiting on payout setup"
          description="These earnings cannot be sent until the instructor saves a PayPal payout email on their profile. They are held, not lost, and will be included automatically once the email is added."
          total={data.blockedTotal}
          groups={data.blocked}
          icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          accentClass="text-amber-700 dark:text-amber-400"
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
          accentClass="text-blue-700 dark:text-blue-400"
          emptyMessage="Nothing is currently in flight."
        />
      ) : null}
    </div>
  );
}

/** Re-exported so pages can pass server-fetched data without a second import. */
export type { UpcomingPayoutsData };
