/**
 * team-travel-fee.ts — the travel & setup fee rules for corporate team bookings.
 * Used by: lib/team-bookings.ts (validation, session write, invoice) and
 *          CreateSessionClient (the editable fee field's default and checks).
 *
 * Pure and dependency-free so the client form and the server share one set of
 * rules. The fee lives on class_sessions.travel_fee, the same column customer
 * requested classes already use, so the session page shows it with no extra work.
 *
 * Rule agreed with the business owner (2026-10-17): every team class carries the
 * fee EXCEPT one where employees pay for their own seat. When the company pays,
 * in either company mode, the fee is added on top of the price.
 */

/** Default travel & setup fee for a company-paid team class, in dollars. */
export const TEAM_TRAVEL_FEE_DEFAULT = 65;

/** Upper bound on a staff-entered fee, a typo guard rather than a business rule. */
export const TEAM_TRAVEL_FEE_MAX = 1000;

/**
 * Checks a staff-entered travel fee.
 * @param fee - The requested fee; null/undefined means "use the default".
 * @returns An error message, or null when the value is acceptable.
 */
export function validateTravelFee(fee: number | null | undefined): string | null {
  if (fee === null || fee === undefined) return null;
  if (typeof fee !== "number" || !Number.isFinite(fee)) {
    return "The travel fee must be a number.";
  }
  if (fee < 0) return "The travel fee cannot be negative.";
  if (fee > TEAM_TRAVEL_FEE_MAX) {
    return `The travel fee cannot be more than $${TEAM_TRAVEL_FEE_MAX}.`;
  }
  return null;
}

/**
 * Decides the fee to store on a team class's session.
 * @param companyPays - True when the company is billed (company or per-signup
 *                      mode); false when employees pay for their own seat.
 * @param requested - The fee staff entered, or null/undefined to take the default.
 * @returns null when employees pay (fee waived, nothing stored), otherwise the
 *          requested fee rounded to cents, or the default when none was given.
 *          0 is a valid answer and means staff deliberately waived it.
 */
export function resolveTeamTravelFee(
  companyPays: boolean,
  requested: number | null | undefined
): number | null {
  if (!companyPays) return null;
  if (requested === null || requested === undefined) return TEAM_TRAVEL_FEE_DEFAULT;
  return Math.round(requested * 100) / 100;
}
