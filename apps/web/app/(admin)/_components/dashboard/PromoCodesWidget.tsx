/**
 * PromoCodesWidget — displays all currently active promo codes.
 * Shown on the instructor dashboard so instructors can quickly confirm whether
 * a code a student mentions is valid without navigating to the admin panel.
 * Shows the code, discount, what it applies to, and its expiry.
 * Used by: InstructorDashboard
 */

/** An active promo code row passed from the server, with scope details resolved. */
export interface ActivePromoCode {
  code: string;
  discount_type: "fixed" | "percent" | "free";
  discount_value: number;
  expires_at: string | null;
  scope: "all" | "session_type" | "session";
  /** Populated when scope = 'session_type': names of the applicable class types. */
  class_type_names: string[];
  /**
   * Populated when scope = 'session': short labels for each applicable session,
   * e.g. "Adult CPR — Tampa · Jul 15, 9:00 AM". Capped at 3; remainder in overflow_count.
   */
  session_labels: string[];
  /** Number of sessions beyond the first 3 (only relevant when scope = 'session'). */
  overflow_count: number;
}

interface Props {
  codes: ActivePromoCode[];
}

/**
 * Formats the discount for display, e.g. "$10.00 off" / "20% off" / "Free".
 * @param type  - Discount type
 * @param value - Numeric value (ignored for free)
 */
function formatDiscount(type: ActivePromoCode["discount_type"], value: number): string {
  if (type === "free") return "Free (100% off)";
  if (type === "percent") return `${value}% off`;
  return `$${value.toFixed(2)} off`;
}

/**
 * Formats the expiry date as a short readable string, or "No expiry".
 * @param expiresAt - ISO timestamp or null
 */
function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "No expiry";
  return new Date(expiresAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Returns the "applies to" description line for a code.
 * @param c - Active promo code with resolved scope details
 */
function appliesTo(c: ActivePromoCode): { summary: string; detail: string[] } {
  if (c.scope === "all") {
    return { summary: "All sessions", detail: [] };
  }
  if (c.scope === "session_type") {
    return {
      summary: c.class_type_names.length > 0 ? c.class_type_names.join(", ") : "—",
      detail: [],
    };
  }
  // session scope
  const extra = c.overflow_count > 0 ? [`+${c.overflow_count} more`] : [];
  return {
    summary: `${c.session_labels.length + c.overflow_count} ${c.session_labels.length + c.overflow_count === 1 ? "session" : "sessions"}`,
    detail: [...c.session_labels, ...extra],
  };
}

/** Lists all active promo codes with scope detail. */
export default function PromoCodesWidget({ codes }: Props) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Active Promo Codes
      </h2>

      {codes.length === 0 ? (
        <p className="text-sm text-gray-400">No active promo codes right now.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {codes.map((c) => {
            const { summary, detail } = appliesTo(c);
            return (
              <li key={c.code} className="py-3 first:pt-0 last:pb-0">
                {/* Top row: code · discount · expiry */}
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono font-bold text-sm text-gray-900 tracking-wide shrink-0">
                    {c.code}
                  </span>
                  <span className="text-sm text-gray-700 shrink-0">
                    {formatDiscount(c.discount_type, c.discount_value)}
                  </span>
                  <span className="text-xs text-gray-400 ml-auto shrink-0">
                    {formatExpiry(c.expires_at)}
                  </span>
                </div>

                {/* Applies-to line */}
                <p className="text-xs text-gray-500 mt-0.5">
                  {c.scope === "all" ? (
                    <span className="italic">{summary}</span>
                  ) : (
                    summary
                  )}
                </p>

                {/* Session detail lines — only for session scope */}
                {detail.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {detail.map((label, i) => (
                      <li key={i} className="text-xs text-gray-400 pl-2 border-l-2 border-gray-200">
                        {label}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
