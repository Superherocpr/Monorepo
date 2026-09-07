/**
 * team-bookings.ts — team / corporate booking creation and lookup.
 *
 * A team booking is a staff-created class plus a shareable signup link. Staff
 * gather the details on a call with the company, create the class from
 * /admin/sessions/new, and hand the resulting /team/<share_token> link to the
 * company contact, who distributes it to their own employees. Each employee
 * signs up with a real account so RollCall sees correct names on class day.
 *
 * Three payment modes:
 *   'company'            — flat total, the contact receives a PayPal invoice
 *                          through the existing invoice system. Employees sign
 *                          up free and may do so before that invoice clears.
 *   'per_seat'           — each employee pays the staff-quoted price at signup.
 *   'company_per_signup' — the company is billed price_per_seat x the number of
 *                          people who signed up. Employees sign up free, and the
 *                          invoice is deliberately deferred: the amount is not
 *                          knowable until signups are in, so it is raised after
 *                          the class by the nightly sweep, or on demand from the
 *                          admin UI at any time.
 *
 * Route files remain responsible for auth, request validation, and mapping
 * results to HTTP responses. This file has no knowledge of Request/Response —
 * same split as lib/invoice-actions.ts.
 */

import { randomUUID } from "node:crypto";
import { sendEmail, isEmailConfigured } from "@/lib/send-email";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClassSession, type CreateClassSessionParams } from "@/lib/session-create";
import { createAndSendInvoice } from "@/lib/invoice-actions";
import {
  teamBookingCreatedEmail,
  teamClassUpdatedEmail,
  teamContactShareLinkEmail,
  teamInvoiceMissingAdminEmail,
  type TeamInvoiceAlertBooking,
} from "@/lib/emails";
import { floatingNow } from "@/lib/business-time";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, "public", any>;

/** Main SuperHeroCPR cancellation line, used unless an instructor owns the booking. */
export const MAIN_CANCELLATION_PHONE = "(813) 966-3969";

/** How a team booking is paid for. */
export type TeamPaymentMode = "company" | "per_seat" | "company_per_signup";

/**
 * True when the company is billed rather than the employees, in either company
 * mode. Employees always sign up free on these, so the public page skips PayPal
 * entirely and the booking is expected to carry an invoice.
 * @param mode - The booking's payment mode.
 * @returns Whether the company (not the employee) pays.
 */
export function isCompanyBilled(mode: TeamPaymentMode | string): boolean {
  return mode === "company" || mode === "company_per_signup";
}

// ---------------------------------------------------------------------------
// Share tokens
// ---------------------------------------------------------------------------

/**
 * Generates the unguessable token that forms the public /team/<token> URL.
 * Uses randomUUID() for the same reason class_sessions.session_token does: the
 * token is the entire credential for the link, so it must not be enumerable.
 * @returns A newly generated UUID v4 string.
 */
export function generateShareToken(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Company/contact and pricing details for a new team booking. */
export interface TeamBookingDetails {
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  paymentMode: TeamPaymentMode;
  /**
   * Required for 'per_seat' (the price each employee pays) and for
   * 'company_per_signup' (the rate the company is billed per person who signs
   * up). Null in 'company' mode.
   */
  pricePerSeat?: number | null;
  /**
   * Required for 'company'. Flat total billed to the company. Null in the other
   * two modes: in 'company_per_signup' the total is computed at invoice time.
   */
  totalPrice?: number | null;
  /** Set when created via "Convert to team booking" from a class request. */
  classRequestId?: string | null;
}

/** Everything needed to create a team booking, with or without a new session. */
export interface CreateTeamBookingParams {
  /** The staff member creating it — drives the public cancellation phone number. */
  actorId: string;
  /** Effective role of the actor. Only manager/super_admin auto-approve the session. */
  actorRole: "instructor" | "manager" | "super_admin";
  details: TeamBookingDetails;
  /**
   * Either attach to an existing class session, or create a brand new private
   * one. Creating is the common path; attaching supports the rare case of
   * pointing a team link at a class already on the calendar.
   */
  target:
    | { kind: "existing"; sessionId: string }
    | {
        kind: "new";
        session: Omit<CreateClassSessionParams, "isPrivate" | "autoApprove">;
      };
}

export type CreateTeamBookingResult =
  | {
      success: true;
      teamBookingId: string;
      sessionId: string;
      shareToken: string;
      /** Null in per_seat mode, or when invoice creation failed (see invoiceError). */
      invoiceNumber: string | null;
      /** Set when the class was created already approved, so the link works immediately. */
      autoApproved: boolean;
      /** Non-fatal invoice failure — the team booking still exists and the link works. */
      invoiceError?: string;
    }
  | { success: false; error: string; status: 400 | 500 };

/**
 * Validates the pricing shape for a team booking before any writes.
 * Mirrors the team_bookings_price_shape_check DB constraint so callers get a
 * clean message instead of a raw constraint violation.
 * @param details - The company/pricing details to check.
 * @returns An error message, or null when the shape is valid.
 */
export function validateTeamPricing(details: TeamBookingDetails): string | null {
  if (details.paymentMode === "per_seat") {
    if (typeof details.pricePerSeat !== "number" || !Number.isFinite(details.pricePerSeat)) {
      return "A price per seat is required when employees pay individually.";
    }
    if (details.pricePerSeat < 0) {
      return "Price per seat cannot be negative.";
    }
    if (details.totalPrice != null) {
      return "A per-seat booking cannot also carry a flat total.";
    }
    return null;
  }

  if (details.paymentMode === "company_per_signup") {
    if (typeof details.pricePerSeat !== "number" || !Number.isFinite(details.pricePerSeat)) {
      return "A rate per signup is required when the company pays per person.";
    }
    // Zero would invoice the company nothing however many people signed up,
    // which is never the intent and produces an invalid PayPal invoice.
    if (details.pricePerSeat <= 0) {
      return "The rate per signup must be greater than zero.";
    }
    if (details.totalPrice != null) {
      return "A per-signup booking's total is calculated at invoice time, not set up front.";
    }
    return null;
  }

  if (typeof details.totalPrice !== "number" || !Number.isFinite(details.totalPrice)) {
    return "A total price is required when the company is paying.";
  }
  if (details.totalPrice <= 0) {
    return "Total price must be greater than zero.";
  }
  if (details.pricePerSeat != null) {
    return "A company-paid booking cannot also carry a per-seat price.";
  }
  return null;
}

/**
 * Creates a team booking: optionally the class session itself, the team_bookings
 * row, and — in company mode — the PayPal invoice sent to the company contact.
 *
 * Side effects: INSERT into class_sessions + session_addons (new-session path),
 * INSERT into team_bookings, and in company mode a PayPal invoice creation plus
 * invoices/invoice_activity_log inserts and a Resend email.
 *
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param params - Actor, company details, and the session target.
 * @returns Identifiers and the share token, or a user-safe error and status.
 */
export async function createTeamBooking(
  adminClient: AnySupabaseClient,
  params: CreateTeamBookingParams
): Promise<CreateTeamBookingResult> {
  const { details, target, actorId, actorRole } = params;

  const pricingError = validateTeamPricing(details);
  if (pricingError) {
    return { success: false, error: pricingError, status: 400 };
  }

  // Manager/super-admin bookings skip the approval queue so the link is live
  // straight away. Instructor-created ones still need approval — book_spot
  // rejects signups on an unapproved session, so the link waits.
  const autoApprove = actorRole === "manager" || actorRole === "super_admin";

  // ── Resolve the session ──────────────────────────────────────────────────
  let sessionId: string;

  if (target.kind === "existing") {
    const { data: existing } = await adminClient
      .from("class_sessions")
      .select("id, status")
      .eq("id", target.sessionId)
      .maybeSingle();

    if (!existing) {
      return { success: false, error: "Class session not found.", status: 400 };
    }
    if (existing.status === "cancelled") {
      return { success: false, error: "That class session is cancelled.", status: 400 };
    }

    // A team booking may already exist for this session — allow it (a company
    // could book two blocks), but the link is per team_bookings row either way.
    sessionId = existing.id as string;
  } else {
    const created = await createClassSession(adminClient, {
      ...target.session,
      // Corporate classes never appear on the public schedule.
      isPrivate: true,
      autoApprove,
    });

    if (!created.success) {
      return { success: false, error: created.error, status: created.status };
    }
    sessionId = created.sessionId;
  }

  // ── Insert the team_bookings row ─────────────────────────────────────────
  const shareToken = generateShareToken();

  const { data: teamRow, error: teamInsertError } = await adminClient
    .from("team_bookings")
    .insert({
      session_id: sessionId,
      company_name: details.companyName.trim(),
      contact_name: details.contactName.trim(),
      contact_email: details.contactEmail.trim().toLowerCase(),
      contact_phone: details.contactPhone?.trim() || null,
      payment_mode: details.paymentMode,
      // Both per_seat and company_per_signup are priced per head; only the payer
      // differs. company mode carries the flat total instead, and a per-signup
      // total stays null until the invoice is raised and computes it.
      price_per_seat: details.paymentMode === "company" ? null : details.pricePerSeat,
      total_price: details.paymentMode === "company" ? details.totalPrice : null,
      share_token: shareToken,
      created_by: actorId,
      class_request_id: details.classRequestId ?? null,
    })
    .select("id")
    .single();

  if (teamInsertError || !teamRow) {
    console.error("[createTeamBooking] team_bookings insert failed:", teamInsertError);
    return { success: false, error: "Failed to create the team booking.", status: 500 };
  }

  const teamBookingId = teamRow.id as string;

  // ── Flat company mode: raise the invoice ─────────────────────────────────
  // Non-fatal by design: the link and the class already exist, and blocking here
  // would strand a created session with no way to reach it. What is NOT
  // optional is telling someone — a failure here means real money goes unbilled,
  // so it alerts super_admins immediately, and both /admin/invoices and the
  // class's own detail page offer a retry. (Before 2026-09-05 this was a bare
  // console.error, and two company bookings went uninvoiced unnoticed.)
  //
  // company_per_signup deliberately raises nothing here: there are zero signups
  // at creation, so the bill would be $0. It is invoiced after the class by the
  // nightly sweep, or on demand from the admin UI. See ensureTeamInvoice.
  let invoiceNumber: string | null = null;
  let invoiceError: string | undefined;

  if (details.paymentMode === "company") {
    const invoiceResult = await createTeamInvoice(adminClient, {
      teamBookingId,
      sessionId,
      actorId,
      details,
    });

    if (invoiceResult.success) {
      invoiceNumber = invoiceResult.invoiceNumber;

      if (!invoiceResult.linked) {
        // The invoice went out but isn't attached to the booking. Left alone,
        // mark_invoice_paid would insert placeholder bookings and double the
        // headcount (THREAT-059), and the sweep would raise a second invoice.
        invoiceError =
          "The invoice was sent but could not be attached to this booking — an admin has been alerted.";
        await notifyTeamInvoiceMissing(
          adminClient,
          [
            {
              teamBookingId,
              companyName: details.companyName,
              contactName: details.contactName,
              contactEmail: details.contactEmail,
              totalPrice: details.totalPrice ?? 0,
              createdAt: new Date().toISOString(),
              classDate: null,
              lastError: `Invoice ${invoiceResult.invoiceNumber} was raised but not linked — set team_bookings.invoice_id by hand. Do NOT retry.`,
            },
          ],
          "booking"
        );
      }
    } else {
      invoiceError = invoiceResult.error;
      console.error("[createTeamBooking] invoice creation failed (non-fatal):", invoiceResult.error);

      await notifyTeamInvoiceMissing(
        adminClient,
        [
          {
            teamBookingId,
            companyName: details.companyName,
            contactName: details.contactName,
            contactEmail: details.contactEmail,
            totalPrice: details.totalPrice ?? 0,
            createdAt: new Date().toISOString(),
            classDate: null,
            lastError: invoiceResult.error,
          },
        ],
        "booking"
      );
    }
  }

  // ── Share-link emails (best-effort) ──────────────────────────────────────
  // Read the real approval status rather than inferring it from autoApprove:
  // the "attach to an existing session" path can point at a class that is
  // itself still awaiting approval, and an unapproved link refuses signups.
  const { data: approvalRow } = await adminClient
    .from("class_sessions")
    .select("approval_status")
    .eq("id", sessionId)
    .maybeSingle();

  const pendingApproval = approvalRow?.approval_status !== "approved";

  // The staff member gets their copy either way, so they have the link without
  // keeping the tab open and can see the invoice number.
  await sendShareLinkEmail(adminClient, {
    actorId,
    sessionId,
    shareToken,
    details,
    invoiceNumber,
    pendingApproval,
  }).catch((err: unknown) => {
    console.error("[createTeamBooking] Share-link email failed (non-fatal):", err);
  });

  // The company contact gets the link automatically, but only once the class is
  // approved — until then the page turns signups away, and mailing a dead link
  // is worse than mailing nothing. approveSession/bulkApproveSession send it on
  // approval instead. See sendContactShareLink.
  if (!pendingApproval) {
    await sendContactShareLink(adminClient, teamBookingId).catch((err: unknown) => {
      console.error("[createTeamBooking] Contact share-link email failed (non-fatal):", err);
    });
  }

  return {
    success: true,
    teamBookingId,
    sessionId,
    shareToken,
    invoiceNumber,
    autoApproved: target.kind === "new" ? autoApprove : false,
    ...(invoiceError ? { invoiceError } : {}),
  };
}

/**
 * Renders a team booking's pricing as one human-readable line, used in staff
 * mail, contact mail, and the admin UI so all three describe it identically.
 * @param mode - The booking's payment mode.
 * @param totalPrice - Flat total, for 'company' mode.
 * @param pricePerSeat - Per-head rate, for the other two modes.
 * @returns A phrase such as "$80.00 per person who signs up".
 */
export function describeTeamPrice(
  mode: TeamPaymentMode | string,
  totalPrice: number | null,
  pricePerSeat: number | null
): string {
  if (mode === "company") {
    return `$${(totalPrice ?? 0).toFixed(2)} total, billed to the company`;
  }
  if (mode === "company_per_signup") {
    return `$${(pricePerSeat ?? 0).toFixed(2)} per person who signs up, billed to the company`;
  }
  return `$${(pricePerSeat ?? 0).toFixed(2)} per seat`;
}

/**
 * Emails the staff member who created a team booking their shareable link, so
 * they have it to forward on without needing to keep the browser tab open.
 * Side effects: a Resend email.
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param args - Creator, session, token, and pricing context for the message.
 */
async function sendShareLinkEmail(
  adminClient: AnySupabaseClient,
  args: {
    actorId: string;
    sessionId: string;
    shareToken: string;
    details: TeamBookingDetails;
    invoiceNumber: string | null;
    pendingApproval: boolean;
  }
): Promise<void> {
  if (!isEmailConfigured()) return;

  const [{ data: actor }, { data: session }] = await Promise.all([
    adminClient.from("profiles").select("first_name, email").eq("id", args.actorId).maybeSingle(),
    adminClient
      .from("class_sessions")
      .select("starts_at, class_types ( name ), locations ( name )")
      .eq("id", args.sessionId)
      .maybeSingle(),
  ]);

  if (!actor?.email || !session) return;

  const classType = Array.isArray(session.class_types) ? session.class_types[0] : session.class_types;
  const location = Array.isArray(session.locations) ? session.locations[0] : session.locations;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
  const priceLabel = describeTeamPrice(
    args.details.paymentMode,
    args.details.totalPrice ?? null,
    args.details.pricePerSeat ?? null
  );

  const { subject, html } = teamBookingCreatedEmail({
    staffFirstName: actor.first_name ?? null,
    companyName: args.details.companyName,
    contactName: args.details.contactName,
    className: classType?.name ?? "CPR Class",
    startsAt: session.starts_at as string,
    locationName: location?.name ?? "",
    shareUrl: `${baseUrl}/team/${args.shareToken}`,
    paymentMode: args.details.paymentMode,
    priceLabel,
    invoiceNumber: args.invoiceNumber,
    pendingApproval: args.pendingApproval,
  });

  // Best-effort: the booking and its share token already exist, and the staff
  // member can copy the link from the admin UI if the mail never lands.
  await sendEmail({
    context: "team-bookings:share-link",
    to: actor.email as string,
    subject,
    html,
    idempotencyKey: `team-share-link-${args.shareToken}`,
  });
}

/**
 * Emails the company contact their signup link, once.
 *
 * Staff used to copy the link out of the admin UI and send it by hand, which is
 * a step that can simply be forgotten. It now goes out automatically: at
 * creation when the class is already approved, and otherwise the moment a
 * manager approves it (an unapproved link refuses signups, so mailing it early
 * would send the contact somewhere that turns their people away).
 *
 * Exactly-once is enforced by claiming `contact_link_sent_at` with a conditional
 * UPDATE before sending. Approving, editing (which resets the class to
 * pending_approval) and re-approving would otherwise mail the same link twice,
 * and Resend's idempotency key only covers a short window. The claim happens
 * first on purpose: a duplicate mail to a customer is worse than a missed one,
 * which staff can still resend by hand from the class page.
 *
 * Side effects: UPDATE on team_bookings.contact_link_sent_at, one Resend email.
 *
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param teamBookingId - The booking whose contact should receive the link.
 * @returns Whether the mail was sent on this call.
 */
export async function sendContactShareLink(
  adminClient: AnySupabaseClient,
  teamBookingId: string
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  const { data: row } = await adminClient
    .from("team_bookings")
    .select(
      `id, session_id, company_name, contact_name, contact_email, share_token,
       payment_mode, total_price, price_per_seat, contact_link_sent_at`
    )
    .eq("id", teamBookingId)
    .maybeSingle();

  if (!row) return false;

  const booking = row as unknown as {
    session_id: string;
    company_name: string;
    contact_name: string;
    contact_email: string;
    share_token: string;
    payment_mode: string;
    total_price: number | string | null;
    price_per_seat: number | string | null;
    contact_link_sent_at: string | null;
  };

  if (booking.contact_link_sent_at) return false;

  const { data: session } = await adminClient
    .from("class_sessions")
    .select(
      `starts_at, ends_at, approval_status, status, instructor_id,
       class_types ( name ),
       locations ( name, address, city, state, zip )`
    )
    .eq("id", booking.session_id)
    .maybeSingle();

  if (!session) return false;

  // Never mail a link the page will turn people away from.
  if (session.approval_status !== "approved" || session.status === "cancelled") return false;

  // Nor one for a class that has already run. Editing an old team class resets
  // it to pending_approval, so re-approving it would otherwise mail the contact
  // a signup link for a class their people already attended.
  const startsAt = session.starts_at as string | null;
  if (startsAt && new Date(startsAt) <= new Date(floatingNow())) return false;

  // Claim the send before doing it. A lost race means another approval path is
  // already mailing this contact, so this call must stay silent.
  const { data: claimed } = await adminClient
    .from("team_bookings")
    .update({ contact_link_sent_at: new Date().toISOString() })
    .eq("id", teamBookingId)
    .is("contact_link_sent_at", null)
    .select("id");

  if (!claimed || claimed.length === 0) return false;

  const classType = Array.isArray(session.class_types) ? session.class_types[0] : session.class_types;
  const location = Array.isArray(session.locations) ? session.locations[0] : session.locations;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
  const perSeat = booking.price_per_seat == null ? null : Number(booking.price_per_seat);
  const total = booking.total_price == null ? null : Number(booking.total_price);

  const { subject, html } = teamContactShareLinkEmail({
    contactName: booking.contact_name,
    companyName: booking.company_name,
    className: classType?.name ?? "CPR Class",
    startsAt: session.starts_at as string,
    locationName: location?.name ?? "",
    locationAddress: [location?.address, location?.city, location?.state, location?.zip]
      .filter(Boolean)
      .join(", "),
    shareUrl: `${baseUrl}/team/${booking.share_token}`,
    paymentMode: booking.payment_mode as TeamPaymentMode,
    pricePerSeat: perSeat,
    priceLabel: describeTeamPrice(booking.payment_mode, total, perSeat),
    supportPhone: await resolveSupportPhone(adminClient, session.instructor_id as string | null),
  });

  const result = await sendEmail({
    context: "team-bookings:contact-link",
    to: booking.contact_email,
    subject,
    html,
    idempotencyKey: `team-contact-link-${booking.share_token}`,
  });

  if (!result.sent) {
    // Release the claim so a later approval or a manual resend can try again.
    // Safe: the mail demonstrably did not go out.
    await adminClient
      .from("team_bookings")
      .update({ contact_link_sent_at: null })
      .eq("id", teamBookingId);
    console.error("[sendContactShareLink] Contact link email failed:", {
      teamBookingId,
      error: result.error,
    });
    return false;
  }

  return true;
}

/**
 * Sends the contact share link for every team booking attached to the given
 * sessions. Called after a class is approved, which is the point an
 * instructor-created team link starts accepting signups.
 *
 * Best-effort and never throws: approval must succeed even if mail does not.
 *
 * Side effects: those of sendContactShareLink, once per booking.
 *
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param sessionIds - Sessions that were just approved.
 */
export async function sendContactLinksForApprovedSessions(
  adminClient: AnySupabaseClient,
  sessionIds: string[]
): Promise<void> {
  try {
    if (sessionIds.length === 0) return;

    const { data } = await adminClient
      .from("team_bookings")
      .select("id")
      .in("session_id", sessionIds)
      .is("contact_link_sent_at", null);

    for (const row of (data ?? []) as { id: string }[]) {
      await sendContactShareLink(adminClient, row.id).catch((err: unknown) => {
        console.error("[sendContactLinksForApprovedSessions] send failed:", err);
      });
    }
  } catch (err) {
    console.error("[sendContactLinksForApprovedSessions] failed:", err);
  }
}

/**
 * Resolves the phone number a company contact should call about a class: the
 * assigned instructor's, falling back to the main line when the class has no
 * instructor yet or that instructor has no number on file.
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param instructorId - The session's assigned instructor, if any.
 * @returns A formatted phone number, never empty.
 */
async function resolveSupportPhone(
  adminClient: AnySupabaseClient,
  instructorId: string | null
): Promise<string> {
  if (!instructorId) return MAIN_CANCELLATION_PHONE;

  const { data } = await adminClient
    .from("profiles")
    .select("phone")
    .eq("id", instructorId)
    .maybeSingle();

  const phone = (data as { phone: string | null } | null)?.phone;
  return phone && phone.trim() ? phone.trim() : MAIN_CANCELLATION_PHONE;
}

/**
 * Raises the flat company invoice for a team booking and links it back.
 *
 * The invoice is deliberately written with student_count = 0 so it never
 * consumes class capacity while unpaid — book_spot counts
 * `sum(student_count) from invoices where status not in ('cancelled','paid')`,
 * and real employee bookings are created as people sign up through the link.
 * A quantity-0 PayPal line would be invalid, so a flat primaryLineItem is
 * supplied instead. Migration 0055 additionally makes mark_invoice_paid skip
 * its placeholder-booking insert for team invoices.
 *
 * Side effects: PayPal invoice creation + send, invoices and
 * invoice_activity_log inserts, a Resend email, and an UPDATE on team_bookings.
 *
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param args - The team booking, its session, the acting staff member, details,
 *               and an optional line description for per-signup billing.
 */
async function createTeamInvoice(
  adminClient: AnySupabaseClient,
  args: {
    teamBookingId: string;
    sessionId: string;
    actorId: string;
    details: TeamBookingDetails;
    /**
     * Shown on the invoice line instead of "flat rate". Set in per-signup mode
     * so the company can check the charge against their own headcount.
     */
    lineDescription?: string;
  }
): Promise<
  | { success: true; invoiceId: string; invoiceNumber: string; linked: boolean }
  | { success: false; error: string }
> {
  const { data: session } = await adminClient
    .from("class_sessions")
    .select(
      `starts_at, instructor_id,
       class_types ( name ),
       locations ( name, city, state )`
    )
    .eq("id", args.sessionId)
    .maybeSingle();

  if (!session) {
    return { success: false, error: "Session not found while raising the invoice." };
  }

  const classType = Array.isArray(session.class_types) ? session.class_types[0] : session.class_types;
  const location = Array.isArray(session.locations) ? session.locations[0] : session.locations;
  const className = classType?.name ?? "CPR Class";

  if (!session.instructor_id) {
    return { success: false, error: "The class has no instructor assigned yet." };
  }

  const { data: instructor } = await adminClient
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", session.instructor_id)
    .maybeSingle();

  const total = args.details.totalPrice as number;

  const result = await createAndSendInvoice(adminClient, {
    sessionId: args.sessionId,
    instructorId: session.instructor_id as string,
    instructorName: instructor ? `${instructor.first_name} ${instructor.last_name}` : null,
    invoiceType: "group",
    recipientName: args.details.contactName.trim(),
    recipientEmail: args.details.contactEmail.trim().toLowerCase(),
    companyName: args.details.companyName.trim(),
    // Zero so this invoice never reserves seats — see the doc comment above.
    studentCount: 0,
    amountPerStudent: total,
    totalAmount: total,
    // Suppresses the per-student breakdown in the invoice UI, which is
    // meaningless for a flat corporate rate.
    customPrice: true,
    notes: args.lineDescription
      ? `Corporate training for ${args.details.companyName.trim()} — ${args.lineDescription}. Billed for everyone who signed up through the team link.`
      : `Corporate training for ${args.details.companyName.trim()} — flat rate. Employees register individually using the team signup link.`,
    className,
    classDate: session.starts_at as string,
    locationName: location?.name ?? "",
    locationCity: location?.city ?? "",
    locationState: location?.state ?? "",
    actorId: args.actorId,
    primaryLineItem: {
      name: args.lineDescription
        ? `Corporate Training — ${className} (${args.lineDescription})`
        : `Corporate Training — ${className}`,
      quantity: 1,
      unitAmount: total,
    },
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  // The `.is("invoice_id", null)` clause makes this write a claim, not a blind
  // overwrite. ensureTeamInvoice() checks invoice_id before calling PayPal, but
  // that check and this write are not atomic — the admin retry button and the
  // nightly sweep can interleave between them. Losing this race means a second
  // invoice really was raised on PayPal, and the guard is what turns that from a
  // silent double-bill into a loud one (THREAT-068).
  const { data: linked, error: linkError } = await adminClient
    .from("team_bookings")
    .update({ invoice_id: result.invoiceId })
    .eq("id", args.teamBookingId)
    .is("invoice_id", null)
    .select("id");

  const lostRace = !linkError && (linked ?? []).length === 0;

  if (lostRace) {
    console.error(
      "[createTeamInvoice] CRITICAL: raised a duplicate invoice — another caller linked one first",
      { teamBookingId: args.teamBookingId, duplicateInvoiceId: result.invoiceId }
    );
  }

  if (linkError) {
    // The invoice exists but isn't linked — mark_invoice_paid would then insert
    // placeholder bookings and double the headcount (THREAT-059). Reported as
    // linked:false rather than as a failure on purpose: the caller must alert a
    // human, and must NOT retry, or the company gets billed twice.
    console.error("[createTeamInvoice] CRITICAL: failed to link invoice to team booking", {
      teamBookingId: args.teamBookingId,
      invoiceId: result.invoiceId,
      error: linkError,
    });
  }

  return {
    success: true,
    invoiceId: result.invoiceId,
    invoiceNumber: result.invoiceNumber,
    // A lost race is reported as unlinked for the same reason a failed write is:
    // a human has to reconcile it, and nothing may retry it automatically.
    linked: !linkError && !lostRace,
  };
}

// ---------------------------------------------------------------------------
// Invoice recovery
// ---------------------------------------------------------------------------

/** Outcome of an attempt to raise (or re-raise) a company-mode team invoice. */
export type EnsureTeamInvoiceResult =
  /** Invoice raised on PayPal, emailed to the contact, and linked to the booking. */
  | { status: "created"; invoiceId: string; invoiceNumber: string }
  /**
   * Invoice raised and emailed, but the team_bookings.invoice_id write failed.
   * Needs a human to set the link by hand — retrying would bill the company
   * twice (THREAT-059).
   */
  | { status: "created_unlinked"; invoiceId: string; invoiceNumber: string }
  /** The booking already has an invoice; nothing to do. */
  | { status: "already_linked"; invoiceId: string }
  /**
   * Correctly has no invoice and owes nothing: a per-signup booking nobody
   * signed up for. Distinct from not_applicable because it is an ordinary
   * outcome, not a fault — the sweep must not alert on it daily forever.
   */
  | { status: "nothing_to_bill"; reason: string }
  /** Not a company-mode booking, or the booking no longer exists. */
  | { status: "not_applicable"; reason: string }
  /** The attempt failed and is safe to retry later. */
  | { status: "failed"; error: string };

/** The team_bookings columns needed to raise an invoice for a booking. */
interface TeamBookingInvoiceRow {
  id: string;
  session_id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  payment_mode: string;
  total_price: number | string | null;
  price_per_seat: number | string | null;
  invoice_id: string | null;
}

/**
 * Counts the people who signed up through a team booking's link.
 *
 * This is the billable headcount in 'company_per_signup' mode: signups, not
 * attendance, per the agreed billing rule. Cancelled bookings are excluded so a
 * company is never billed for a seat that was given back.
 *
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param teamBookingId - The booking whose signups to count.
 * @returns The number of live signups, or null if the count could not be read.
 */
export async function countTeamSignups(
  adminClient: AnySupabaseClient,
  teamBookingId: string
): Promise<number | null> {
  const { count, error } = await adminClient
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("team_booking_id", teamBookingId)
    .eq("cancelled", false);

  if (error) {
    console.error("[countTeamSignups] count failed:", error);
    return null;
  }

  return count ?? 0;
}

/**
 * Raises the company invoice for a team booking that does not have one yet.
 *
 * Idempotent by design and safe to call repeatedly: it re-reads the booking and
 * short-circuits when `invoice_id` is already set, so the admin retry button,
 * the nightly sweep, and a double-click can never bill a company twice.
 *
 * This exists because invoice creation at booking time is deliberately
 * non-fatal — the class and share link must survive a PayPal outage — which
 * until 2026-09-05 left the booking permanently uninvoiced with no way to
 * recover it. Shared by POST /api/team-bookings/invoice (admin retry) and
 * POST /api/team-bookings/retry-invoices (daily cron sweep).
 *
 * Side effects (only on the "created" paths): PayPal invoice creation + send,
 * invoices and invoice_activity_log inserts, a Resend email to the company
 * contact, and an UPDATE on team_bookings.invoice_id.
 *
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param args - The booking to invoice and the staff member to attribute it to.
 * @returns What happened, discriminated so callers can tell "retry later" from
 *          "stop and get a human" from "nothing to do".
 */
export async function ensureTeamInvoice(
  adminClient: AnySupabaseClient,
  args: { teamBookingId: string; actorId: string }
): Promise<EnsureTeamInvoiceResult> {
  const { data: row, error: loadError } = await adminClient
    .from("team_bookings")
    .select(
      `id, session_id, company_name, contact_name, contact_email, contact_phone,
       payment_mode, total_price, price_per_seat, invoice_id`
    )
    .eq("id", args.teamBookingId)
    .maybeSingle();

  if (loadError) {
    console.error("[ensureTeamInvoice] team_bookings lookup failed:", loadError);
    return { status: "failed", error: "Could not load the team booking." };
  }

  if (!row) {
    return { status: "not_applicable", reason: "Team booking not found." };
  }

  const booking = row as unknown as TeamBookingInvoiceRow;

  if (booking.invoice_id) {
    return { status: "already_linked", invoiceId: booking.invoice_id };
  }

  if (!isCompanyBilled(booking.payment_mode)) {
    return {
      status: "not_applicable",
      reason: "Employees pay individually on this booking, so there is no company invoice.",
    };
  }

  // ── Work out what to bill ────────────────────────────────────────────────
  let total: number;
  let signupCount: number | null = null;

  if (booking.payment_mode === "company_per_signup") {
    // The amount is the headcount at this moment, so it is computed here rather
    // than read: the sweep bills what signed up by class day, and a staff member
    // raising it early bills what has signed up so far.
    const rate = Number(booking.price_per_seat);
    if (!Number.isFinite(rate) || rate <= 0) {
      return {
        status: "not_applicable",
        reason: "This per-signup booking has no rate to bill against.",
      };
    }

    signupCount = await countTeamSignups(adminClient, booking.id);
    if (signupCount === null) {
      return { status: "failed", error: "Could not count the signups for this booking." };
    }
    if (signupCount === 0) {
      // Nothing owed. Not a failure: a company that filled no seats owes nothing,
      // and a $0 PayPal invoice is both meaningless and rejected by the API.
      return {
        status: "nothing_to_bill",
        reason: "Nobody has signed up through this link yet, so there is nothing to bill.",
      };
    }

    total = Math.round(rate * signupCount * 100) / 100;
  } else {
    total = Number(booking.total_price);
    if (!Number.isFinite(total) || total <= 0) {
      // A company booking with no total violates team_bookings_price_shape_check,
      // so this is corrupt data rather than a transient failure — never retryable.
      return {
        status: "not_applicable",
        reason: "This company booking has no total price to invoice.",
      };
    }
  }

  const result = await createTeamInvoice(adminClient, {
    teamBookingId: booking.id,
    sessionId: booking.session_id,
    actorId: args.actorId,
    details: {
      companyName: booking.company_name,
      contactName: booking.contact_name,
      contactEmail: booking.contact_email,
      contactPhone: booking.contact_phone,
      paymentMode: "company",
      pricePerSeat: null,
      totalPrice: total,
    },
    // Gives the company a line they can check against their own headcount.
    lineDescription:
      signupCount === null
        ? undefined
        : `${signupCount} ${signupCount === 1 ? "person" : "people"} at $${Number(
            booking.price_per_seat
          ).toFixed(2)} each`,
  });

  if (!result.success) {
    return { status: "failed", error: result.error };
  }

  // Record what was actually billed so the invoices page, the class page, and
  // any later audit agree with the figure that went to PayPal. Best-effort: the
  // invoice itself is the source of truth, and invoice_id is already linked.
  if (booking.payment_mode === "company_per_signup") {
    const { error: totalError } = await adminClient
      .from("team_bookings")
      .update({ total_price: total })
      .eq("id", booking.id);

    if (totalError) {
      console.error("[ensureTeamInvoice] failed to record computed total:", totalError);
    }
  }

  return {
    status: result.linked ? "created" : "created_unlinked",
    invoiceId: result.invoiceId,
    invoiceNumber: result.invoiceNumber,
  };
}

/**
 * Emails every active super_admin about company-mode team bookings that still
 * have no invoice.
 *
 * This is the health signal for the feature (CLAUDE.md §6). Invoice creation
 * fails silently by construction — it is non-fatal at booking time — so without
 * an outbound alert the only evidence is a console line nobody reads and a SQL
 * invariant somebody has to remember to run. Called both at booking time (one
 * booking, immediately) and by the daily sweep (a digest of whatever is still
 * outstanding).
 *
 * Best-effort: a mail failure is logged and swallowed so it can never abort a
 * booking or turn the cron run into a retry loop.
 *
 * Side effects: reads profiles, sends one email via Resend.
 *
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param bookings - Uninvoiced bookings to report, newest first.
 * @param trigger - Whether this fired at booking time or from the daily sweep;
 *                  changes the wording only.
 */
export async function notifyTeamInvoiceMissing(
  adminClient: AnySupabaseClient,
  bookings: TeamInvoiceAlertBooking[],
  trigger: "booking" | "sweep"
): Promise<void> {
  try {
    if (bookings.length === 0) return;

    if (!isEmailConfigured()) {
      console.warn("[team-bookings] Resend not configured — skipping uninvoiced alert.");
      return;
    }

    const { data: admins } = await adminClient
      .from("profiles")
      .select("email")
      .eq("role", "super_admin")
      .eq("archived", false)
      .eq("deactivated", false);

    const recipients = ((admins ?? []) as { email: string | null }[])
      .map((a) => a.email)
      .filter((email): email is string => Boolean(email));

    if (recipients.length === 0) {
      console.error("[team-bookings] No super_admin recipients for uninvoiced alert.");
      return;
    }

    const { subject, html } = teamInvoiceMissingAdminEmail({
      bookings,
      trigger,
      baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com",
    });

    await sendEmail({
      context: "team-bookings:invoice-missing",
      to: recipients,
      subject,
      html,
      // Deduped per booking per day, so the sweep re-alerts daily until the
      // invoice exists but a single day's retries collapse into one message.
      idempotencyKey: `team-invoice-missing-${trigger}-${bookings
        .map((b) => b.teamBookingId)
        .sort()
        .join("-")
        .slice(0, 120)}-${new Date().toISOString().slice(0, 10)}`,
    });
  } catch (err) {
    console.error("[team-bookings] Uninvoiced alert failed (non-fatal):", err);
  }
}

/**
 * Emails everyone currently signed up for a team-booking class when the class
 * itself changes: certification, date/time, or location.
 *
 * Team-booking classes can be edited by their instructor or a manager at any
 * time, including after an edit that would normally send an ordinary class
 * back to pending_approval and off the public schedule — team bookings are
 * exempt from that reset (see updateSession()), since the entire point is that
 * corrections should not interrupt people actively using the signup link. This
 * email is the substitute for that review step: it tells the one audience the
 * change actually affects, at the moment it happens, rather than letting
 * someone show up to find a different class than they signed up for.
 *
 * Best-effort: called after class_sessions is already saved, so a mail failure
 * must never be surfaced as a failed edit.
 *
 * Side effects: reads bookings + profiles + class_types + locations, sends one
 * Resend email per active attendee.
 *
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param args - The session, its company name, and the NEW (just-saved) class
 *               type, location, and times.
 */
export async function notifyTeamClassUpdated(
  adminClient: AnySupabaseClient,
  args: {
    sessionId: string;
    companyName: string;
    classTypeId: string;
    locationId: string;
    startsAt: string;
  }
): Promise<void> {
  try {
    if (!isEmailConfigured()) return;

    const [{ data: bookingRows }, { data: classType }, { data: location }] = await Promise.all([
      adminClient
        .from("bookings")
        .select("profiles!bookings_customer_id_fkey ( first_name, email )")
        .eq("session_id", args.sessionId)
        .eq("cancelled", false),
      adminClient.from("class_types").select("name").eq("id", args.classTypeId).maybeSingle(),
      adminClient
        .from("locations")
        .select("name, address, city, state, zip")
        .eq("id", args.locationId)
        .maybeSingle(),
    ]);

    if (!bookingRows || bookingRows.length === 0) return;

    const className = (classType as { name: string } | null)?.name ?? "CPR Class";
    const locationName = (location as { name: string } | null)?.name ?? "";
    const locationAddress = [
      (location as { address?: string } | null)?.address,
      (location as { city?: string } | null)?.city,
      (location as { state?: string } | null)?.state,
      (location as { zip?: string } | null)?.zip,
    ]
      .filter(Boolean)
      .join(", ");

    type ProfileRef = { first_name: string | null; email: string | null };

    for (const row of bookingRows as unknown as { profiles: ProfileRef | ProfileRef[] | null }[]) {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      if (!profile?.email) continue;

      const { subject, html } = teamClassUpdatedEmail({
        firstName: profile.first_name,
        companyName: args.companyName,
        className,
        startsAt: args.startsAt,
        locationName,
        locationAddress,
      });

      await sendEmail({
        context: "team-bookings:class-updated",
        to: profile.email,
        subject,
        html,
      });
    }
  } catch (err) {
    console.error("[notifyTeamClassUpdated] Failed (non-fatal):", err);
  }
}

// ---------------------------------------------------------------------------
// Public lookup
// ---------------------------------------------------------------------------

/** One person who has signed up through the team link. Names only, by design. */
export interface TeamAttendee {
  firstName: string;
  lastName: string;
}

/** Everything the public /team/<token> page needs to render. */
export interface TeamBookingPublicView {
  teamBookingId: string;
  companyName: string;
  paymentMode: TeamPaymentMode;
  /** What an employee pays. 0 in company mode — the company already covers it. */
  pricePerSeat: number;
  sessionId: string;
  className: string;
  startsAt: string;
  endsAt: string;
  locationName: string;
  locationAddress: string;
  locationCity: string;
  locationState: string;
  locationZip: string;
  instructorName: string | null;
  /**
   * Phone shown for questions and cancellations: the assigned instructor's, so
   * the company reaches the person actually running their class.
   */
  cancellationPhone: string;
  maxCapacity: number;
  spotsRemaining: number;
  /** True once the class is full, cancelled, or already started. */
  closed: boolean;
  /** Why signups are closed, for a clear message. Null when open. */
  closedReason: "full" | "cancelled" | "past" | "unapproved" | null;
  attendees: TeamAttendee[];
  attendeeCount: number;
}

/**
 * Loads the public view of a team booking by its share token.
 *
 * Deliberately returns first/last names only — never emails or profile ids.
 * The share token is a bearer credential the company forwards freely, so the
 * response must contain nothing that could identify or contact an attendee
 * beyond what a person in the room would already see.
 *
 * @param adminClient - Admin Supabase client (RLS-bypassing; the token is the auth).
 * @param shareToken - The token from the /team/<token> URL.
 * @returns The public view, or null when the token doesn't match a booking.
 */
export async function getTeamBookingByShareToken(
  adminClient: AnySupabaseClient,
  shareToken: string
): Promise<TeamBookingPublicView | null> {
  const { data: team } = await adminClient
    .from("team_bookings")
    .select(
      `id, company_name, payment_mode, price_per_seat, session_id, created_by,
       class_sessions (
         id, starts_at, ends_at, max_capacity, status, approval_status, instructor_id,
         class_types ( name ),
         locations ( name, address, city, state, zip )
       )`
    )
    .eq("share_token", shareToken)
    .maybeSingle();

  if (!team || !team.class_sessions) return null;

  const session = Array.isArray(team.class_sessions) ? team.class_sessions[0] : team.class_sessions;
  if (!session) return null;

  const classType = Array.isArray(session.class_types) ? session.class_types[0] : session.class_types;
  const location = Array.isArray(session.locations) ? session.locations[0] : session.locations;

  // ── Attendees: active bookings on this session, names only ───────────────
  // Scoped to the session rather than to team_booking_id so the count matches
  // the real room. If staff also added someone manually or by invoice, the
  // company contact should see them — the point of the list is confirming who
  // will actually be there.
  // The FK hint is required, not optional: bookings has three foreign keys to
  // profiles (customer_id, created_by, cancelled_by), so a bare profiles(...)
  // embed is ambiguous and PostgREST rejects the whole query — which silently
  // emptied the attendee list and overstated spotsRemaining.
  const { data: bookingRows, error: bookingsError } = await adminClient
    .from("bookings")
    .select("customer_id, created_at, profiles!bookings_customer_id_fkey ( first_name, last_name )")
    .eq("session_id", session.id)
    .eq("cancelled", false)
    .order("created_at", { ascending: true });

  if (bookingsError) {
    // Never fail open on the seat maths — an unknown attendee count must not
    // read as "plenty of room left".
    console.error("[getTeamBookingByShareToken] Attendee lookup failed:", bookingsError);
    return null;
  }

  const attendees: TeamAttendee[] = (bookingRows ?? [])
    .map((row: { profiles: unknown }) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const typed = profile as { first_name?: string; last_name?: string } | null;
      if (!typed?.first_name && !typed?.last_name) return null;
      return {
        firstName: typed?.first_name ?? "",
        lastName: typed?.last_name ?? "",
      };
    })
    .filter((a): a is TeamAttendee => a !== null);

  // Seats consumed, mirroring book_spot: active bookings plus unpaid invoice
  // slots. Team invoices carry student_count = 0 so they contribute nothing.
  const { data: invoiceRows } = await adminClient
    .from("invoices")
    .select("student_count, status")
    .eq("class_session_id", session.id)
    .not("status", "in", '("cancelled","paid")');

  const invoiceSeats = (invoiceRows ?? []).reduce(
    (sum: number, row: { student_count: number | null }) => sum + (row.student_count ?? 0),
    0
  );

  const activeBookings = (bookingRows ?? []).length;
  const maxCapacity = (session.max_capacity as number) ?? 0;
  const spotsRemaining = Math.max(0, maxCapacity - activeBookings - invoiceSeats);

  // ── Instructor + cancellation contact ────────────────────────────────────
  const instructorId = session.instructor_id as string | null;
  const [{ data: instructor }, { data: creator }] = await Promise.all([
    instructorId
      ? adminClient
          .from("profiles")
          .select("first_name, last_name, phone")
          .eq("id", instructorId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    adminClient
      .from("profiles")
      .select("role, phone")
      .eq("id", team.created_by)
      .maybeSingle(),
  ]);

  // The company calls the instructor teaching their class, since that is who can
  // actually answer about the day itself. Falls back to the creating instructor
  // (they took the booking, so the company already knows them), then the main
  // line when the class has no instructor assigned yet.
  const instructorPhone = (instructor as { phone?: string | null } | null)?.phone;
  const cancellationPhone =
    instructorPhone && instructorPhone.trim()
      ? instructorPhone.trim()
      : creator?.role === "instructor" && creator.phone
        ? (creator.phone as string)
        : MAIN_CANCELLATION_PHONE;

  const closedReason: TeamBookingPublicView["closedReason"] =
    session.status === "cancelled"
      ? "cancelled"
      : session.approval_status !== "approved"
        ? "unapproved"
        : new Date(session.starts_at as string) <= new Date(floatingNow())
          ? "past"
          : spotsRemaining <= 0
            ? "full"
            : null;

  // Only 'per_seat' charges the employee. In both company modes the rate on the
  // row is what the COMPANY owes, so the employee-facing price is zero and must
  // never be read from price_per_seat.
  const rawPerSeat = team.price_per_seat;
  const pricePerSeat =
    team.payment_mode === "per_seat"
      ? typeof rawPerSeat === "number"
        ? rawPerSeat
        : parseFloat(String(rawPerSeat ?? "0"))
      : 0;

  return {
    teamBookingId: team.id as string,
    companyName: team.company_name as string,
    paymentMode: team.payment_mode as TeamPaymentMode,
    pricePerSeat: Number.isFinite(pricePerSeat) ? pricePerSeat : 0,
    sessionId: session.id as string,
    className: classType?.name ?? "CPR Class",
    startsAt: session.starts_at as string,
    endsAt: session.ends_at as string,
    locationName: location?.name ?? "",
    locationAddress: location?.address ?? "",
    locationCity: location?.city ?? "",
    locationState: location?.state ?? "",
    locationZip: location?.zip ?? "",
    instructorName: instructor ? `${instructor.first_name} ${instructor.last_name}` : null,
    cancellationPhone,
    maxCapacity,
    spotsRemaining,
    closed: closedReason !== null,
    closedReason,
    attendees,
    attendeeCount: attendees.length,
  };
}
