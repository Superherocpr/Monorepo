"use client";

/**
 * SessionDetailClient — full interactive UI for the admin session detail page.
 * Handles approval, rejection, editing, cancellation, CSV export, and all inline forms.
 * Used by: app/(admin)/admin/sessions/[id]/page.tsx
 */

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/users";
import type { SessionStatus, SessionApprovalStatus } from "@/types/schedule";
import { OWNER_DIRECT_PHONE } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import {
  ROLLCALL_VERIFIED_EVENT,
  rollcallChannelTopic,
} from "@/lib/rollcall-realtime";
import {
  approveSession,
  rejectSession,
  updateSession,
  setSessionAssistant,
  setSessionAddons,
  type SessionEditFields,
} from "@/app/(admin)/admin/sessions/[id]/actions";

// ─── Exported types (imported by the server component) ────────────────────────

/** A booking row joined with customer profile and payments, as returned by the page query. */
export interface SessionBooking {
  id: string;
  cancelled: boolean;
  booking_source: string;
  grade: number | null;
  profiles: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
  } | null;
  payments: Array<{ status: string; payment_type: string; amount: number }>;
}

/** A roster record row from the session query. */
export interface SessionRosterRecord {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  employer: string | null;
  grade: number | null;
  confirmed: boolean;
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/** Editable contact fields for the customer-info modal. */
interface ContactFormValues {
  email: string;
  phone: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  zip: string;
}

const EMPTY_CONTACT_FORM: ContactFormValues = {
  email: "",
  phone: "",
  address_1: "",
  address_2: "",
  city: "",
  state: "",
  zip: "",
};

/** An invoice row from the session query. */
export interface SessionInvoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  recipient_name: string;
  recipient_email: string;
  company_name: string | null;
  student_count: number;
  total_amount: number;
  status: string;
  created_at: string;
}

/** A roster upload row from the session query. */
export interface SessionRosterUpload {
  id: string;
  original_filename: string;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  imported: boolean;
  created_at: string;
}

/** Full session detail shape passed from the server component. */
export interface SessionDetailData {
  id: string;
  starts_at: string;
  ends_at: string;
  status: SessionStatus;
  approval_status: SessionApprovalStatus;
  rejection_reason: string | null;
  max_capacity: number;
  notes: string | null;
  enrollware_submitted: boolean;
  roster_imported: boolean;
  correction_window_closes_at: string | null;
  /** Promotional discount as a percentage (0–50). Null = no discount. */
  discount_percent: number | null;
  /** Flat travel & setup fee for customer-requested sessions. Null for regular sessions. */
  travel_fee: number | null;
  /** UUID of the originating class_requests row. Null for staff-created sessions. */
  class_request_id: string | null;
  class_type_id: string;
  /** Null until an instructor accepts a customer-requested session. */
  instructor_id: string | null;
  location_id: string;
  /** Platform instructor assigned as assistant. Mutually exclusive with assistant_name. */
  assistant_instructor_id: string | null;
  /** Free-text assistant name, for someone outside the platform. Mutually exclusive with assistant_instructor_id. */
  assistant_name: string | null;
  /** IDs of add-ons currently offered on this session (session_addons). */
  addon_ids: string[];
  /** Extra hours added on top of the class type's default duration. 0 = no extra time. */
  additional_hours: number;
  class_types: {
    id: string;
    name: string;
    price: number;
    duration_minutes: number;
    requires_assistant_at_capacity: boolean;
  } | null;
  instructor: { id: string; first_name: string; last_name: string } | null;
  assistant_instructor: { id: string; first_name: string; last_name: string } | null;
  locations: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  bookings: SessionBooking[];
  roster_records: SessionRosterRecord[];
  invoices: SessionInvoice[];
  roster_uploads: SessionRosterUpload[];
}

/** A class type option for the edit form dropdown. */
export interface ClassTypeOption {
  id: string;
  name: string;
  price: number;
  duration_minutes: number;
}

/** A location option for the edit form dropdown. */
export interface LocationOption {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

/** An instructor option for the edit form dropdown (manager/super admin only). */
export interface InstructorOption {
  id: string;
  first_name: string;
  last_name: string;
}

/** An add-on eligible for this session's class type (addon_class_types). */
export interface AddonOption {
  id: string;
  name: string;
  price: number;
}

// ─── Component props ──────────────────────────────────────────────────────────

interface Props {
  session: SessionDetailData;
  userId: string;
  userRole: UserRole;
  classTypes: ClassTypeOption[];
  locations: LocationOption[];
  instructors: InstructorOption[];
  /** Add-ons eligible for this session's class type — empty if the class type has none. */
  eligibleAddons: AddonOption[];
}

// ─── Badge helper functions ───────────────────────────────────────────────────

/**
 * Returns Tailwind classes for a session status badge.
 * @param status - The session status value.
 */
function sessionStatusBadgeClass(status: SessionStatus): string {
  const map: Record<SessionStatus, string> = {
    scheduled: "bg-blue-100 text-blue-700",
    in_progress: "bg-amber-100 text-amber-700",
    completed: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
  };
  return map[status] ?? "bg-gray-100 text-gray-700";
}

/**
 * Returns a human-readable label for a session status value.
 * @param status - The session status value.
 */
function sessionStatusLabel(status: SessionStatus): string {
  const map: Record<SessionStatus, string> = {
    scheduled: "Scheduled",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return map[status] ?? status;
}

/**
 * Returns Tailwind classes for an approval status badge.
 * @param status - The approval status value.
 */
function approvalBadgeClass(status: SessionApprovalStatus): string {
  const map: Record<SessionApprovalStatus, string> = {
    pending_approval: "bg-amber-100 text-amber-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
  };
  return map[status] ?? "bg-gray-100 text-gray-700";
}

/**
 * Returns a human-readable label for an approval status value.
 * @param status - The approval status value.
 */
function approvalStatusLabel(status: SessionApprovalStatus): string {
  const map: Record<SessionApprovalStatus, string> = {
    pending_approval: "Pending Approval",
    approved: "Approved",
    rejected: "Rejected",
  };
  return map[status] ?? status;
}

/**
 * Returns Tailwind classes for an invoice status badge.
 * @param status - The invoice status value (sent, paid, cancelled).
 */
function invoiceStatusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    sent: "bg-blue-100 text-blue-700",
    paid: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
  };
  return map[status] ?? "bg-gray-100 text-gray-700";
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

/**
 * Formats an ISO timestamp for display. Returns e.g. "Mon, Apr 21, 2026 — 9:00 AM".
 * @param iso - ISO datetime string from the database.
 */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Converts a UTC ISO timestamp to the format expected by a datetime-local input,
 * expressed in the browser's local timezone so the displayed time matches the
 * actual class time as seen by the user.
 * Example: "2026-04-21T14:00:00Z" in CDT (UTC-5) → "2026-04-21T09:00"
 * @param iso - UTC ISO datetime string from the database.
 */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Triggers a CSV file download in the browser with the given content.
 * @param content - The CSV string content.
 * @param filename - The suggested filename for the download.
 */
function downloadFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Renders the full session detail page UI with all interactive sections.
 * Sections are role-gated per the admin page guide.
 */
export default function SessionDetailClient({
  session,
  userId,
  userRole,
  classTypes,
  locations,
  instructors,
  eligibleAddons,
}: Props) {
  const router = useRouter();

  // ── Live-updating Verified column ─────────────────────────────────────────
  // When a student completes rollcall, the API broadcasts on a channel scoped
  // to this session so the instructor's page can refresh without a manual
  // reload. Only wired up for sessions where a check-in could still happen —
  // completed/cancelled sessions get no new roster activity.
  useEffect(() => {
    if (session.status !== "scheduled" && session.status !== "in_progress") {
      return;
    }

    const supabase = createClient();
    const channel = supabase
      .channel(rollcallChannelTopic(session.id))
      .on("broadcast", { event: ROLLCALL_VERIFIED_EVENT }, () => {
        router.refresh();
      })
      .subscribe();

    // Fallback in case the websocket drops silently (laptop sleep, wifi
    // blip) — keeps the page converging even without a live broadcast.
    const pollInterval = setInterval(() => {
      router.refresh();
    }, 45_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.status]);

  const isInstructor = userRole === "instructor";
  const isManager = userRole === "manager" || userRole === "super_admin";
  const isSuperAdmin = userRole === "super_admin";
  const isOwnSession = session.instructor_id === userId;

  // Whether the current user can see the invoices section
  const canSeeInvoices = isSuperAdmin || (isInstructor && isOwnSession);

  // Whether the current user can use grading and enrollware tools
  const canUseTools = isSuperAdmin || (isInstructor && isOwnSession);

  // ── UI state ──────────────────────────────────────────────────────────────

  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showApproveEditWarning, setShowApproveEditWarning] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [showCallDanielModal, setShowCallDanielModal] = useState(false);

  const [rejectReason, setRejectReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [claimLocationId, setClaimLocationId] = useState(session.location_id);

  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  // ── Manual verified toggle state ──────────────────────────────────────────
  // confirmedOverrides: keyed by roster_record id — optimistic updates for
  // both roster rows and booking rows that have a matching roster_record.
  const [confirmedOverrides, setConfirmedOverrides] = useState<Record<string, boolean>>({});
  // bookingVerifiedOverrides: keyed by booking id — for students who booked
  // online but never went through rollcall (no roster_record exists yet).
  const [bookingVerifiedOverrides, setBookingVerifiedOverrides] = useState<Record<string, boolean>>({});
  // Set of keys currently being toggled (mix of roster_record ids and "b-{booking_id}").
  const [togglingVerifiedIds, setTogglingVerifiedIds] = useState<Set<string>>(new Set());

  // ── Edit form state (pre-populated from session data) ─────────────────────

  const [editClassTypeId, setEditClassTypeId] = useState(
    session.class_type_id
  );
  const [editInstructorId, setEditInstructorId] = useState(
    session.instructor_id ?? ""
  );
  const [editLocationId, setEditLocationId] = useState(session.location_id);
  const [editStartsAt, setEditStartsAt] = useState(
    toDatetimeLocal(session.starts_at)
  );
  const [editEndsAt, setEditEndsAt] = useState(
    toDatetimeLocal(session.ends_at)
  );
  const [editMaxCapacity, setEditMaxCapacity] = useState(session.max_capacity);
  const [editNotes, setEditNotes] = useState(session.notes ?? "");
  const [editDiscountPercent, setEditDiscountPercent] = useState<string>(
    session.discount_percent != null ? String(session.discount_percent) : ""
  );

  // ── Additional hours state ────────────────────────────────────────────────
  const [additionalHours, setAdditionalHours] = useState<number>(session.additional_hours);
  const [isSavingAdditionalHours, setIsSavingAdditionalHours] = useState(false);
  const [additionalHoursError, setAdditionalHoursError] = useState<string | null>(null);

  // ── Edit customer info modal state ────────────────────────────────────────
  // Scoped to roster_records only — never the customer's account-wide profile.
  // See /api/sessions/[id]/customer-info for why this is enough for Enrollware.
  const [editingCustomer, setEditingCustomer] = useState<{
    key: string; // roster_record id, or `booking-${booking.id}` when no roster_record exists yet
    mode: "roster" | "booking";
    id: string; // roster_record_id or booking_id, matching `mode`
    name: string;
  } | null>(null);
  const [contactForm, setContactForm] = useState<ContactFormValues>(EMPTY_CONTACT_FORM);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  /** Local overrides keyed by the same `key` used in editingCustomer, applied after a successful save. */
  const [contactOverrides, setContactOverrides] = useState<Record<string, ContactFormValues>>({});

  // ── Assistant assignment state (documentation only, no pay impact) ────────

  const [assistantMode, setAssistantMode] = useState<"instructor" | "name">(
    session.assistant_name ? "name" : "instructor"
  );
  const [assistantInstructorId, setAssistantInstructorId] = useState(
    session.assistant_instructor_id ?? ""
  );
  const [assistantNameInput, setAssistantNameInput] = useState(session.assistant_name ?? "");
  const [isSavingAssistant, setIsSavingAssistant] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);

  // ── Session add-ons state ──────────────────────────────────────────────────

  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>(session.addon_ids);
  const [isSavingAddons, setIsSavingAddons] = useState(false);
  const [addonsError, setAddonsError] = useState<string | null>(null);

  /** Adds or removes an addon ID from the selected set. */
  function toggleAddon(id: string) {
    setSelectedAddonIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]
    );
  }

  /**
   * Saves the session's add-on selection.
   * Side effect: setSessionAddons server action, page refresh on success.
   */
  async function handleSaveAddons() {
    setIsSavingAddons(true);
    setAddonsError(null);
    const result = await setSessionAddons(session.id, selectedAddonIds);
    setIsSavingAddons(false);
    if (result) {
      setAddonsError(result);
    } else {
      router.refresh();
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  /** Non-cancelled bookings count */
  const activeBookings = useMemo(
    () => session.bookings.filter((b) => !b.cancelled).length,
    [session.bookings]
  );

  /**
   * Set of lowercase emails already represented by active bookings.
   * Used to deduplicate roster_records so the same person never appears twice.
   */
  const bookingEmailSet = useMemo(() => {
    const set = new Set<string>();
    session.bookings
      .filter((b) => !b.cancelled)
      .forEach((b) => {
        if (b.profiles?.email) set.add(b.profiles.email.toLowerCase());
      });
    return set;
  }, [session.bookings]);

  /**
   * Roster records that don’t already appear in active bookings.
   * A student who checked in via rollcall will have both a booking row AND a
   * roster_record row. We hide the roster_record duplicate to avoid showing
   * the same person twice in the student table.
   */
  const uniqueRosterRecords = useMemo(() => {
    const seenEmails = new Set<string>(bookingEmailSet);
    return session.roster_records.filter((r) => {
      // Roster records with no email are always shown (can’t match)
      if (!r.email) return true;
      const key = r.email.toLowerCase();
      // Skip if already visible via a booking row, or duplicated within roster
      if (seenEmails.has(key)) return false;
      seenEmails.add(key);
      return true;
    });
  }, [session.roster_records, bookingEmailSet]);

  /** Total students (active bookings + deduplicated roster records) */
  const totalStudents = activeBookings + uniqueRosterRecords.length;

  /**
   * Grade lookup by lowercase email from ALL roster_records (including those
   * hidden by the dedup filter). The grading tool writes to roster_records,
   * not to bookings, so booking-sourced students need this map to show their
   * grade correctly.
   */
  const rosterGradeByEmail = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const r of session.roster_records) {
      if (r.email && r.grade !== null) {
        map.set(r.email.toLowerCase(), r.grade);
      }
    }
    return map;
  }, [session.roster_records]);

  /**
   * Set of lowercase emails whose roster_record has confirmed=true.
   * confirmed is only set when the student actively taps "This is correct"
   * (or saves edits) on the rollcall info screen — not from roster imports
   * or the password sign-in path.
   */
  const verifiedEmailSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of session.roster_records) {
      if (r.confirmed && r.email) set.add(r.email.toLowerCase());
    }
    return set;
  }, [session.roster_records]);

  /**
   * Map from lowercase email → roster_record.
   * Used by booking rows to find their matching roster_record for the verified toggle.
   */
  const rosterRecordByEmail = useMemo(() => {
    const map = new Map<string, SessionRosterRecord>();
    for (const r of session.roster_records) {
      if (r.email) map.set(r.email.toLowerCase(), r);
    }
    return map;
  }, [session.roster_records]);

  /** Students who have been graded */
  const gradedCount = useMemo(() => {
    // For booking rows, prefer the grade from the matching roster_record (set
    // by the grading tool) then fall back to bookings.grade.
    const fromBookings = session.bookings.filter((b) => {
      if (b.cancelled) return false;
      const email = b.profiles?.email?.toLowerCase();
      const rosterGrade = email ? rosterGradeByEmail.get(email) : undefined;
      return (rosterGrade ?? b.grade) !== null;
    }).length;
    const fromRoster = uniqueRosterRecords.filter(
      (r) => r.grade !== null
    ).length;
    return fromBookings + fromRoster;
  }, [session.bookings, uniqueRosterRecords, rosterGradeByEmail]);

  /** Roster upload waiting to be imported, if any */
  const pendingRosterUpload = useMemo(
    () => session.roster_uploads.find((u) => !u.imported) ?? null,
    [session.roster_uploads]
  );

  // ── Additional hours handler ──────────────────────────────────────────────

  /**
   * Saves a new additional_hours value for this session.
   * Optimistically updates local state; reverts on failure.
   * @param hours - One of the preset values: 0, 1, 2, or 4.
   */
  async function handleSelectAdditionalHours(hours: number): Promise<void> {
    const previous = additionalHours;
    setAdditionalHours(hours);
    setIsSavingAdditionalHours(true);
    setAdditionalHoursError(null);

    try {
      const res = await fetch(`/api/sessions/${session.id}/additional-hours`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additional_hours: hours }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        console.error("[additional-hours] Save failed:", json.error ?? res.status);
        setAdditionalHours(previous);
        setAdditionalHoursError("Failed to save — please try again.");
      }
    } catch {
      setAdditionalHours(previous);
      setAdditionalHoursError("Failed to save — please try again.");
    } finally {
      setIsSavingAdditionalHours(false);
    }
  }

  // ── Edit customer info handlers ───────────────────────────────────────────

  /** Opens the customer-info modal for a roster-only student row. */
  function openEditRoster(r: SessionRosterRecord): void {
    setEditingCustomer({
      key: r.id,
      mode: "roster",
      id: r.id,
      name: `${r.first_name} ${r.last_name}`,
    });
    setContactForm(
      contactOverrides[r.id] ?? {
        email: r.email ?? "",
        phone: r.phone ?? "",
        address_1: r.address_1 ?? "",
        address_2: r.address_2 ?? "",
        city: r.city ?? "",
        state: r.state ?? "",
        zip: r.zip ?? "",
      }
    );
    setContactError(null);
  }

  /**
   * Opens the customer-info modal for a booking row.
   * Prefers the matching roster_record's contact info (source of truth for
   * Enrollware) over the booking's account profile; falls back to the
   * profile's email/phone when no roster_record exists yet.
   */
  function openEditBooking(b: SessionBooking): void {
    const emailKey = b.profiles?.email?.toLowerCase() ?? "";
    const rosterRecord = rosterRecordByEmail.get(emailKey);
    const key = rosterRecord ? rosterRecord.id : `booking-${b.id}`;
    const mode: "roster" | "booking" = rosterRecord ? "roster" : "booking";
    const id = rosterRecord ? rosterRecord.id : b.id;

    setEditingCustomer({
      key,
      mode,
      id,
      name: b.profiles ? `${b.profiles.first_name} ${b.profiles.last_name}` : "Student",
    });
    setContactForm(
      contactOverrides[key] ?? {
        email: rosterRecord?.email ?? b.profiles?.email ?? "",
        phone: rosterRecord?.phone ?? b.profiles?.phone ?? "",
        address_1: rosterRecord?.address_1 ?? "",
        address_2: rosterRecord?.address_2 ?? "",
        city: rosterRecord?.city ?? "",
        state: rosterRecord?.state ?? "",
        zip: rosterRecord?.zip ?? "",
      }
    );
    setContactError(null);
  }

  /**
   * Saves the customer-info form for the student currently open in the modal.
   * Updates roster_records only — see /api/sessions/[id]/customer-info.
   * Side effect: PATCH request, local optimistic override on success.
   */
  async function handleSaveContactInfo(): Promise<void> {
    if (!editingCustomer) return;
    setIsSavingContact(true);
    setContactError(null);

    try {
      const body =
        editingCustomer.mode === "roster"
          ? { roster_record_id: editingCustomer.id, ...contactForm }
          : { booking_id: editingCustomer.id, ...contactForm };

      const res = await fetch(`/api/sessions/${session.id}/customer-info`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setContactError(json.error ?? "Failed to save. Please try again.");
        return;
      }

      setContactOverrides((prev) => ({ ...prev, [editingCustomer.key]: contactForm }));
      setEditingCustomer(null);
    } catch {
      setContactError("Failed to save. Please try again.");
    } finally {
      setIsSavingContact(false);
    }
  }

  // ── Verified toggle handler ───────────────────────────────────────────────

  /**
   * Flips the confirmed status on a student's roster_record.
   * Optimistically updates the UI; reverts if the API call fails.
   *
   * @param mode - 'roster' for a direct roster_record id; 'booking' for a
   *   booking whose roster_record must be found or created by the API.
   * @param id - The roster_record id (mode='roster') or booking id (mode='booking').
   * @param currentConfirmed - The current confirmed value before the toggle.
   */
  async function handleToggleVerified(
    mode: "roster" | "booking",
    id: string,
    currentConfirmed: boolean
  ): Promise<void> {
    const newConfirmed = !currentConfirmed;
    const stateKey = mode === "booking" ? `b-${id}` : id;

    setTogglingVerifiedIds((prev) => new Set(prev).add(stateKey));

    if (mode === "booking") {
      setBookingVerifiedOverrides((prev) => ({ ...prev, [id]: newConfirmed }));
    } else {
      setConfirmedOverrides((prev) => ({ ...prev, [id]: newConfirmed }));
    }

    try {
      const body =
        mode === "booking"
          ? { booking_id: id, confirmed: newConfirmed }
          : { roster_record_id: id, confirmed: newConfirmed };

      const res = await fetch(`/api/sessions/${session.id}/verify-student`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        console.error("[verify-student] Failed:", json.error ?? res.status);
        throw new Error();
      }
    } catch {
      // Revert optimistic update on failure
      if (mode === "booking") {
        setBookingVerifiedOverrides((prev) => ({ ...prev, [id]: currentConfirmed }));
      } else {
        setConfirmedOverrides((prev) => ({ ...prev, [id]: currentConfirmed }));
      }
    } finally {
      setTogglingVerifiedIds((prev) => {
        const next = new Set(prev);
        next.delete(stateKey);
        return next;
      });
    }
  }

  // ── Action handlers ───────────────────────────────────────────────────────

  /**
   * Approves the session. Direct action, no confirmation required.
   * Side effect: DB update via server action, page refresh on success.
   */
  async function handleApprove() {
    setIsApproving(true);
    setActionError(null);
    const error = await approveSession(session.id);
    setIsApproving(false);
    if (error) {
      setActionError(error);
    } else {
      router.refresh();
    }
  }

  /**
   * Submits the rejection form. Validates min length before calling server action.
   * Side effect: DB update via server action, form hidden, page refresh on success.
   */
  async function handleReject() {
    setIsRejecting(true);
    setActionError(null);
    const error = await rejectSession(session.id, rejectReason);
    setIsRejecting(false);
    if (error) {
      setActionError(error);
    } else {
      setShowRejectForm(false);
      setRejectReason("");
      router.refresh();
    }
  }

  /**
   * Submits the cancellation form. Validates min length, then calls the cancel
   * API route, which sets the session to an open opportunity any instructor
   * can claim. Side effect: DB update, form hidden, page refresh on success.
   */
  async function handleCancel() {
    setIsCancelling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? "Could not cancel this session. Please try again.");
        return;
      }
      setShowCancelForm(false);
      setCancelReason("");
      router.refresh();
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setIsCancelling(false);
    }
  }

  /**
   * Handles the Edit button click.
   * If the session is approved, shows the warning before revealing the form.
   * Otherwise, shows the edit form directly.
   */
  function handleEditClick() {
    if (session.approval_status === "approved") {
      setShowApproveEditWarning(true);
    } else {
      setShowEditForm(true);
    }
  }

  /**
   * Submits the edit form. Resets approval if the session was previously approved.
   * Side effect: DB update via server action, form hidden, page refresh on success.
   */
  async function handleSaveEdit() {
    setIsSavingEdit(true);
    setActionError(null);
    // datetime-local strings have no timezone — new Date() interprets them as
    // local time, so .toISOString() correctly converts back to UTC for storage.
    const parsedDiscount = editDiscountPercent === "" ? null : parseFloat(editDiscountPercent);
    const fields: SessionEditFields = {
      class_type_id: editClassTypeId,
      instructor_id: editInstructorId,
      location_id: editLocationId,
      starts_at: new Date(editStartsAt).toISOString(),
      ends_at: new Date(editEndsAt).toISOString(),
      max_capacity: editMaxCapacity,
      discount_percent: (parsedDiscount !== null && !isNaN(parsedDiscount)) ? parsedDiscount : null,
      notes: editNotes,
    };
    const wasApproved = session.approval_status === "approved";
    const error = await updateSession(session.id, fields, wasApproved);
    setIsSavingEdit(false);
    if (error) {
      setActionError(error);
    } else {
      setShowEditForm(false);
      router.refresh();
    }
  }

  /**
   * Builds and downloads a CSV of all students in this session.
   * Combines active bookings (with customer profiles) and roster records.
   * Available to super admins on completed sessions only.
   */
  function handleExportCSV() {
    const headers = [
      "First Name",
      "Last Name",
      "Email",
      "Phone",
      "Employer",
      "Grade",
      "Source",
    ];

    const fromBookings = session.bookings
      .filter((b) => !b.cancelled)
      .map((b) => [
        b.profiles?.first_name ?? "",
        b.profiles?.last_name ?? "",
        b.profiles?.email ?? "",
        b.profiles?.phone ?? "",
        "",
        b.grade?.toString() ?? "",
        b.booking_source,
      ]);

    const fromRoster = session.roster_records.map((r) => [
      r.first_name,
      r.last_name,
      r.email ?? "",
      r.phone ?? "",
      r.employer ?? "",
      r.grade?.toString() ?? "",
      "roster",
    ]);

    const rows = [headers, ...fromBookings, ...fromRoster];
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const date = new Date(session.starts_at).toISOString().slice(0, 10);
    const className = session.class_types?.name ?? "session";
    downloadFile(csv, `${className}-${date}-students.csv`);
  }

  // ── Can edit logic ────────────────────────────────────────────────────────

  const canEdit =
    isManager ||
    (isInstructor &&
      isOwnSession &&
      session.approval_status !== "approved");

  // ── Session add-ons ─────────────────────────────────────────────────────────

  /** Add-ons may be managed regardless of approval status — same reasoning as the assistant below. */
  const canManageAddons = isManager || (isInstructor && isOwnSession);

  // ── Assistant assignment (documentation only, no pay impact) ───────────────

  /** Assistant may be managed regardless of approval status — it's not part of the reviewed edit fields. */
  const canManageAssistant = isManager || (isInstructor && isOwnSession);
  const hasAssistant = session.assistant_instructor_id !== null || session.assistant_name !== null;
  const ASSISTANT_THRESHOLD = 9;
  const needsAssistant =
    session.class_types?.requires_assistant_at_capacity === true &&
    activeBookings >= ASSISTANT_THRESHOLD &&
    !hasAssistant;
  /** Instructors selectable as assistant — excludes whoever is already teaching the session. */
  const assistantInstructorOptions = instructors.filter((inst) => inst.id !== session.instructor_id);

  /**
   * Saves the assistant assignment (platform instructor or free-text name).
   * Side effect: setSessionAssistant server action, page refresh on success.
   */
  async function handleSaveAssistant() {
    setIsSavingAssistant(true);
    setAssistantError(null);
    try {
      const result = await setSessionAssistant(session.id, {
        instructorId: assistantMode === "instructor" ? assistantInstructorId || null : null,
        name: assistantMode === "name" ? assistantNameInput || null : null,
      });
      if (result) {
        setAssistantError(result);
        return;
      }
      router.refresh();
    } catch {
      setAssistantError("Network error. Please try again.");
    } finally {
      setIsSavingAssistant(false);
    }
  }

  /**
   * Clears the current assistant assignment.
   * Side effect: setSessionAssistant server action, page refresh on success.
   */
  async function handleClearAssistant() {
    setIsSavingAssistant(true);
    setAssistantError(null);
    try {
      const result = await setSessionAssistant(session.id, { instructorId: null, name: null });
      if (result) {
        setAssistantError(result);
        return;
      }
      setAssistantInstructorId("");
      setAssistantNameInput("");
      router.refresh();
    } catch {
      setAssistantError("Network error. Please try again.");
    } finally {
      setIsSavingAssistant(false);
    }
  }

  // ── Accept to Teach (customer-requested sessions with no instructor yet) ───

  /**
   * Claims the customer-requested session for the calling instructor.
   * Uses a conditional server-side update (WHERE instructor_id IS NULL) so only
   * the first caller succeeds. On 409 another instructor got there first.
   */
  async function handleAcceptTeach() {
    setIsAccepting(true);
    setAcceptError(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/accept-teach`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.status === 409) {
        setAcceptError("This class was just claimed by another instructor.");
        return;
      }
      if (!res.ok) {
        setAcceptError(json.error ?? "Could not accept this class. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setAcceptError("Network error. Please try again.");
    } finally {
      setIsAccepting(false);
    }
  }

  // Whether this is an unassigned customer-requested session
  const isCustomerRequested = session.class_request_id !== null;
  const needsInstructor = isCustomerRequested && session.instructor_id === null;
  const isAssignedToMe = session.instructor_id === userId;

  // ── Claim This Class (cancelled sessions reopened as an open opportunity) ──

  /**
   * Claims a cancelled, unclaimed session for the calling instructor, setting
   * the location they'll teach from. Uses a conditional server-side update
   * (WHERE instructor_id IS NULL) so only the first caller succeeds.
   * On 409 another instructor got there first.
   */
  async function handleClaim() {
    setIsClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location_id: claimLocationId }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setClaimError("This class was just claimed by another instructor.");
        return;
      }
      if (!res.ok) {
        setClaimError(json.error ?? "Could not claim this class. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setClaimError("Network error. Please try again.");
    } finally {
      setIsClaiming(false);
    }
  }

  // Whether this session was cancelled and is open for any instructor to claim
  const isOpenOpportunity = session.status === "cancelled" && session.instructor_id === null;

  // ── Start Class ───────────────────────────────────────────────────────────

  /**
   * Transitions a scheduled, approved session to in_progress.
   * Available to the assigned instructor and managers/super admins.
   * Side effect: PATCH /api/sessions/[id]/status, page refresh on success.
   */
  async function handleStartClass() {
    setIsStarting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_progress" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? "Could not start the class. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setIsStarting(false);
    }
  }

  const canStartClass =
    session.status === "scheduled" &&
    session.approval_status === "approved" &&
    (isManager || (isInstructor && isOwnSession));

  // ── Cancel eligibility ────────────────────────────────────────────────────

  const canCancel =
    session.status !== "cancelled" &&
    (isManager || (isInstructor && isOwnSession));

  // Instructors cannot cancel online within 48 hours of the class starting —
  // they're directed to call the owner directly instead. Managers/super_admins
  // are never restricted by this window.
  const hoursUntilStart = new Date(session.starts_at).getTime() - Date.now();
  const instructorBlockedByWindow =
    isInstructor && !isManager && hoursUntilStart < 48 * 60 * 60 * 1000;

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Global action error banner ── */}
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* ── Call Daniel modal (instructor blocked from cancelling within 48hrs) ── */}
      {showCallDanielModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full space-y-3">
            <h2 className="text-base font-bold text-gray-900">
              This class starts in less than 48 hours
            </h2>
            <p className="text-sm text-gray-600">
              Classes within 48 hours can&apos;t be cancelled online. Please call Daniel Hedgeman
              directly to cancel:
            </p>
            <a
              href={`tel:${OWNER_DIRECT_PHONE.replace(/[^\d+]/g, "")}`}
              className="block text-center px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors"
            >
              Call {OWNER_DIRECT_PHONE}
            </a>
            <button
              type="button"
              onClick={() => setShowCallDanielModal(false)}
              className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Edit customer info modal ── */}
      {editingCustomer && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="text-base font-bold text-gray-900">Edit Contact Info</h2>
              <p className="text-sm text-gray-500">{editingCustomer.name}</p>
            </div>
            <p className="text-xs text-gray-500">
              Updates this student&apos;s info for this class only — for Enrollware
              submission accuracy. Does not change their SuperheroCPR account.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, email: e.target.value }))}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input
                  type="tel"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Address Line 1</label>
                <input
                  type="text"
                  value={contactForm.address_1}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, address_1: e.target.value }))}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Address Line 2</label>
                <input
                  type="text"
                  value={contactForm.address_2}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, address_2: e.target.value }))}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
                  <input
                    type="text"
                    value={contactForm.city}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, city: e.target.value }))}
                    className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
                  <input
                    type="text"
                    value={contactForm.state}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, state: e.target.value }))}
                    className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Zip</label>
                  <input
                    type="text"
                    value={contactForm.zip}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, zip: e.target.value }))}
                    className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>
            </div>

            {contactError && <p className="text-xs text-red-700 font-medium">{contactError}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleSaveContactInfo()}
                disabled={isSavingContact}
                className="flex-1 px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isSavingContact ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditingCustomer(null)}
                disabled={isSavingContact}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Claim This Class banner (cancelled session reopened as an open opportunity) ── */}
      {isOpenOpportunity && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-5 space-y-3">
          <h2 className="text-base font-bold text-amber-900">
            ⚡ This Class Is Open — First Come, First Serve
          </h2>
          <p className="text-sm text-amber-800">
            This class was cancelled by its previous instructor and needs a new one. Choose the
            location you&apos;ll teach from and claim it.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <select
              value={claimLocationId}
              onChange={(e) => setClaimLocationId(e.target.value)}
              className="text-sm border border-amber-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleClaim}
              disabled={isClaiming}
              className="shrink-0 bg-amber-600 text-white font-bold px-5 py-2.5 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isClaiming ? "Claiming…" : "Claim This Class"}
            </button>
          </div>
          {claimError && <p className="text-sm text-red-700 font-medium">{claimError}</p>}
        </div>
      )}

      {/* ── Accept to Teach banner (customer-requested sessions only) ── */}
      {isCustomerRequested && needsInstructor && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <h2 className="text-base font-bold text-amber-900 mb-1">
                ⚡ This Class Needs an Instructor — First Come, First Serve
              </h2>
              <p className="text-sm text-amber-800">
                A customer requested this class at their location. The first instructor to accept
                will be assigned. A <strong>$65 travel &amp; setup fee</strong> is included.
              </p>
              {acceptError && (
                <p className="text-sm text-red-700 font-medium mt-2">{acceptError}</p>
              )}
            </div>
            <button
              onClick={handleAcceptTeach}
              disabled={isAccepting}
              className="shrink-0 bg-amber-600 text-white font-bold px-5 py-2.5 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isAccepting ? "Claiming…" : "Accept to Teach"}
            </button>
          </div>
        </div>
      )}

      {/* ── Assistant needed banner (identical copy for all roles, stays until an assistant is added) ── */}
      {needsAssistant && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-5 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div>
            <h2 className="text-base font-bold text-amber-900 mb-1">
              This Class Needs an Assistant
            </h2>
            <p className="text-sm text-amber-800">
              This class has {activeBookings} paid students. Classes of this size require an
              in-room assistant — add one below before class day.
            </p>
          </div>
        </div>
      )}

      {/* ── Already assigned to me banner ── */}
      {isCustomerRequested && isAssignedToMe && (
        <div className="bg-green-50 border border-green-300 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm font-medium text-green-800">
            You accepted this customer-requested class. You are the assigned instructor.
          </p>
        </div>
      )}

      {/* ══ Section 1: Header ══ */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">

        {/* Title row */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {session.class_types?.name ?? "Class Session"}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {formatDateTime(session.starts_at)} - {formatDateTime(session.ends_at)}
            </p>
          </div>

          {/* Badge strip */}
          <div className="flex flex-wrap gap-2 shrink-0">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${approvalBadgeClass(session.approval_status)}`}
            >
              {approvalStatusLabel(session.approval_status)}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${sessionStatusBadgeClass(session.status)}`}
            >
              {sessionStatusLabel(session.status)}
            </span>
            {session.discount_percent != null && session.discount_percent > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                {session.discount_percent}% OFF
              </span>
            )}
            {session.enrollware_submitted && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                Submitted to Enrollware
              </span>
            )}
          </div>
        </div>

        {/* Session meta */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Instructor
            </p>
            <p className="text-gray-800 mt-0.5">
              {session.instructor
                ? `${session.instructor.first_name} ${session.instructor.last_name}`
                : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Location
            </p>
            {session.locations ? (
              <div className="text-gray-800 mt-0.5">
                <p>{session.locations.name}</p>
                <p className="text-gray-500">
                  {session.locations.address},{" "}
                  {session.locations.city}, {session.locations.state}{" "}
                  {session.locations.zip}
                </p>
              </div>
            ) : (
              <p className="text-gray-800 mt-0.5">-</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Capacity
            </p>
            <p className="text-gray-800 mt-0.5">
              {activeBookings} / {session.max_capacity} students
            </p>
          </div>
          {session.class_types && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Price / Person
              </p>
              {session.discount_percent != null && session.discount_percent > 0 ? (
                <p className="text-gray-800 mt-0.5">
                  <span className="line-through text-gray-400 mr-1">
                    {session.class_types.price === 0 ? "Free" : `$${Number(session.class_types.price).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
                  </span>
                  <span className="font-semibold text-green-700">
                    {session.class_types.price === 0 ? "Free" : `$${(Number(session.class_types.price) * (1 - session.discount_percent / 100)).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
                  </span>
                </p>
              ) : (
                <p className="text-gray-800 mt-0.5">
                  {session.class_types.price === 0 ? "Free" : `$${Number(session.class_types.price).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
                </p>
              )}
            </div>
          )}
          {session.travel_fee != null && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Travel &amp; Setup Fee
              </p>
              <p className="text-gray-800 mt-0.5 font-semibold">
                ${Number(session.travel_fee).toFixed(2)}
              </p>
            </div>
          )}
          {session.class_request_id && isManager && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Source
              </p>
              <Link
                href={`/admin/class-requests/${session.class_request_id}`}
                className="text-sm text-red-600 hover:underline mt-0.5 inline-block"
              >
                Customer Request →
              </Link>
            </div>
          )}
          {session.class_types?.requires_assistant_at_capacity && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Assistant
              </p>
              <p className="text-gray-800 mt-0.5">
                {session.assistant_instructor
                  ? `${session.assistant_instructor.first_name} ${session.assistant_instructor.last_name}`
                  : session.assistant_name
                    ? session.assistant_name
                    : "Not assigned"}
              </p>
            </div>
          )}
        </div>

        {/* ── Assistant assignment (documentation only, no pay impact) ── */}
        {canManageAssistant && session.class_types?.requires_assistant_at_capacity && (
          <div className="border border-gray-200 rounded-md p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-800">Class Assistant</p>
            <p className="text-xs text-gray-500">
              For documentation only — does not affect instructor pay. Assign a platform
              instructor or enter the name of someone outside the platform.
            </p>

            {hasAssistant ? (
              <div className="flex items-center justify-between gap-3 bg-gray-50 rounded-md px-3 py-2">
                <p className="text-sm text-gray-800">
                  {session.assistant_instructor
                    ? `${session.assistant_instructor.first_name} ${session.assistant_instructor.last_name}`
                    : session.assistant_name}
                </p>
                <button
                  type="button"
                  onClick={handleClearAssistant}
                  disabled={isSavingAssistant}
                  className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-4 text-xs">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={assistantMode === "instructor"}
                      onChange={() => setAssistantMode("instructor")}
                    />
                    Platform instructor
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={assistantMode === "name"}
                      onChange={() => setAssistantMode("name")}
                    />
                    Name only
                  </label>
                </div>

                {assistantMode === "instructor" ? (
                  <select
                    value={assistantInstructorId}
                    onChange={(e) => setAssistantInstructorId(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">Select an instructor…</option>
                    {assistantInstructorOptions.map((inst) => (
                      <option key={inst.id} value={inst.id}>
                        {inst.first_name} {inst.last_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={assistantNameInput}
                    onChange={(e) => setAssistantNameInput(e.target.value)}
                    placeholder="Assistant's name"
                    className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                )}

                {assistantError && <p className="text-xs text-red-700 font-medium">{assistantError}</p>}

                <button
                  type="button"
                  onClick={handleSaveAssistant}
                  disabled={
                    isSavingAssistant ||
                    (assistantMode === "instructor" ? !assistantInstructorId : !assistantNameInput.trim())
                  }
                  className="px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingAssistant ? "Saving…" : "Add Assistant"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Additional hours ── */}
        {canManageAssistant && (
          <div className="border border-gray-200 rounded-md p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-800">Additional Hours</p>
            <p className="text-xs text-gray-500">
              Hours added on top of the class type&apos;s default duration. Use this when a
              session runs longer than usual for Enrollware reporting.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {([0, 1, 2, 4] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  disabled={isSavingAdditionalHours}
                  aria-pressed={additionalHours === h}
                  onClick={() => void handleSelectAdditionalHours(h)}
                  className={`min-w-[52px] px-3 py-1.5 rounded-md text-sm font-medium border transition-colors disabled:opacity-50 ${
                    additionalHours === h
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-white text-gray-700 border-gray-300 hover:border-red-400 hover:text-red-600"
                  }`}
                >
                  +{h}h
                </button>
              ))}
              <input
                type="number"
                min={0}
                step={1}
                disabled={isSavingAdditionalHours}
                placeholder="Custom"
                aria-label="Custom additional hours"
                defaultValue=""
                onBlur={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 0) {
                    void handleSelectAdditionalHours(val);
                    e.target.value = "";
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="w-24 text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
              />
            </div>
            {additionalHoursError && (
              <p className="text-xs text-red-600 font-medium">{additionalHoursError}</p>
            )}
            {isSavingAdditionalHours && (
              <p className="text-xs text-gray-400">Saving…</p>
            )}
          </div>
        )}

        {/* ── Session add-ons ── */}
        {canManageAddons && eligibleAddons.length > 0 && (
          <div className="border border-gray-200 rounded-md p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-800">Class Add-ons</p>
            <p className="text-xs text-gray-500">
              Which add-ons customers can purchase for this specific session.
            </p>

            <div className="space-y-2">
              {eligibleAddons.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedAddonIds.includes(a.id)}
                    onChange={() => toggleAddon(a.id)}
                    className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <span>
                    {a.name} <span className="text-gray-400">(${a.price.toFixed(2)})</span>
                  </span>
                </label>
              ))}
            </div>

            {addonsError && <p className="text-xs text-red-700 font-medium">{addonsError}</p>}

            <button
              type="button"
              onClick={handleSaveAddons}
              disabled={isSavingAddons}
              className="px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSavingAddons ? "Saving…" : "Save Add-ons"}
            </button>
          </div>
        )}

        {/* Rejection reason — shown when session is rejected */}
        {session.approval_status === "rejected" && session.rejection_reason && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
            <p className="font-medium">This session was not approved.</p>
            <p className="mt-1">Reason: {session.rejection_reason}</p>
            {isInstructor && isOwnSession && (
              <button
                type="button"
                onClick={handleEditClick}
                className="mt-2 text-red-700 underline hover:text-red-900 text-xs font-medium"
              >
                Edit this session and resubmit for approval →
              </button>
            )}
          </div>
        )}

        {/* ── Approve edit warning (shown before revealing edit form for approved sessions) ── */}
        {showApproveEditWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-800 space-y-3">
            <p className="font-medium">
              Editing this session will reset it to pending approval and remove
              it from the public schedule until re-approved.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowApproveEditWarning(false);
                  setShowEditForm(true);
                }}
                className="px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-md hover:bg-amber-700 transition-colors"
              >
                Confirm - Edit Anyway
              </button>
              <button
                type="button"
                onClick={() => setShowApproveEditWarning(false)}
                className="px-3 py-1.5 bg-white border border-amber-300 text-amber-800 text-xs font-semibold rounded-md hover:bg-amber-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Inline edit form ── */}
        {showEditForm && (
          <div className="border border-gray-200 rounded-md p-4 space-y-4 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-900">
              Edit Class Session
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Class type */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Class Type
                </label>
                <select
                  value={editClassTypeId}
                  onChange={(e) => setEditClassTypeId(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {classTypes.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Instructor — manager/super admin only can change */}
              {isManager && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Instructor
                  </label>
                  <select
                    value={editInstructorId}
                    onChange={(e) => setEditInstructorId(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {instructors.map((inst) => (
                      <option key={inst.id} value={inst.id}>
                        {inst.first_name} {inst.last_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Location */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Location
                </label>
                <select
                  value={editLocationId}
                  onChange={(e) => setEditLocationId(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Max capacity */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Max Capacity
                </label>
                <input
                  type="number"
                  min={1}
                  value={editMaxCapacity}
                  onChange={(e) =>
                    setEditMaxCapacity(parseInt(e.target.value, 10) || 1)
                  }
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {/* Start date/time */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Start Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={editStartsAt}
                  onChange={(e) => setEditStartsAt(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {/* End date/time */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  End Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={editEndsAt}
                  onChange={(e) => setEditEndsAt(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>

            {/* Discount */}
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-700">
                  Discount (optional, max 50%)
                </label>
                {editDiscountPercent && parseFloat(editDiscountPercent) > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                    {parseFloat(editDiscountPercent)}% OFF
                  </span>
                )}
              </div>
              <div className="flex gap-1.5 mb-2">
                {([10, 20, 25, 50] as const).map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setEditDiscountPercent(String(pct))}
                    className={[
                      "flex-1 py-1.5 rounded-md text-xs font-semibold border transition-colors duration-150",
                      editDiscountPercent === String(pct)
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-white text-gray-700 border-gray-300 hover:border-red-400 hover:text-red-600",
                    ].join(" ")}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={editDiscountPercent}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "" || parseFloat(raw) <= 50) setEditDiscountPercent(raw);
                  }}
                  onBlur={() => {
                    const n = parseFloat(editDiscountPercent);
                    if (!isNaN(n) && n > 50) setEditDiscountPercent("50");
                  }}
                  placeholder="Custom % (0 – 50)"
                  className="flex-1 text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <span className="text-xs text-gray-500 select-none">%</span>
                {editDiscountPercent && (
                  <button
                    type="button"
                    onClick={() => setEditDiscountPercent("")}
                    className="text-xs text-gray-400 hover:text-red-600 transition-colors whitespace-nowrap"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Notes (internal)
              </label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 resize-y"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isSavingEdit ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => setShowEditForm(false)}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Header action buttons ── */}
        {!showEditForm && !showApproveEditWarning && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">

            {/* Approval actions — manager/super admin only, pending sessions only */}
            {isManager && session.approval_status === "pending_approval" && (
              <>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={isApproving}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {isApproving ? "Approving…" : "Approve"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRejectForm(!showRejectForm);
                    setActionError(null);
                  }}
                  className="px-4 py-2 bg-white border border-red-300 text-red-600 text-sm font-semibold rounded-md hover:bg-red-50 transition-colors"
                >
                  Reject
                </button>
              </>
            )}

            {/* Start Class button — approved + scheduled sessions only */}
            {canStartClass && (
              <button
                type="button"
                onClick={handleStartClass}
                disabled={isStarting}
                className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isStarting ? "Starting…" : "Start Class"}
              </button>
            )}

            {/* Show QR Page — classroom rollcall display. Own sessions only:
                the display's refresh action regenerates the viewer's own code. */}
            {isOwnSession &&
              session.approval_status === "approved" &&
              (session.status === "scheduled" ||
                session.status === "in_progress") && (
                <Link
                  href={`/admin/sessions/${session.id}/checkin`}
                  className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors"
                >
                  Show QR Page
                </Link>
              )}

            {/* Edit button */}
            {canEdit && (
              <button
                type="button"
                onClick={handleEditClick}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 transition-colors"
              >
                Edit
              </button>
            )}

            {/* Cancel session — manager/super_admin any time; instructor on their
                own session, but blocked within 48hrs of start (see modal) */}
            {canCancel && (
              <button
                type="button"
                onClick={() => {
                  if (instructorBlockedByWindow) {
                    setShowCallDanielModal(true);
                    return;
                  }
                  setShowCancelForm(!showCancelForm);
                  setActionError(null);
                }}
                className="px-4 py-2 bg-white border border-red-300 text-red-600 text-sm font-semibold rounded-md hover:bg-red-50 transition-colors"
              >
                Cancel Session
              </button>
            )}
          </div>
        )}

        {/* ── Inline rejection form ── */}
        {showRejectForm && (
          <div className="border border-red-200 rounded-md p-4 space-y-3 bg-red-50">
            <h3 className="text-sm font-semibold text-red-900">
              Rejection Reason
            </h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why this session is being rejected (min 10 characters)…"
              rows={3}
              className="w-full text-sm border border-red-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 resize-y bg-white"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleReject}
                disabled={isRejecting || rejectReason.trim().length < 10}
                className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isRejecting ? "Rejecting…" : "Confirm Rejection"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRejectForm(false);
                  setRejectReason("");
                }}
                className="px-4 py-2 bg-white border border-red-300 text-red-700 text-sm font-semibold rounded-md hover:bg-red-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Inline cancel session form ── */}
        {showCancelForm && (
          <div className="border border-red-200 rounded-md p-4 space-y-3 bg-red-50">
            <h3 className="text-sm font-semibold text-red-900">
              Cancel This Session?
            </h3>
            <p className="text-sm text-red-700">
              This class becomes an open opportunity for other instructors to claim. Booked
              students are only notified once a new instructor picks it up — not now.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation (min 10 characters)…"
              rows={3}
              className="w-full text-sm border border-red-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 resize-y bg-white"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancel}
                disabled={isCancelling || cancelReason.trim().length < 10}
                className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isCancelling ? "Cancelling…" : "Confirm Cancellation"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCancelForm(false);
                  setCancelReason("");
                }}
                className="px-4 py-2 bg-white border border-red-300 text-red-700 text-sm font-semibold rounded-md hover:bg-red-50 transition-colors"
              >
                Keep Session
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Desktop two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ══ Section 2: Students (left, 2 cols) ══ */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">
                Students
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({totalStudents})
                </span>
              </h2>
              {/* Import Roster button — manager/super admin only */}
              {isManager && (
                <Link
                  href={`/admin/sessions/${session.id}/roster`}
                  className="text-sm font-medium text-red-600 hover:text-red-700"
                >
                  Import Roster
                </Link>
              )}
            </div>

            {/* Pending roster upload banner */}
            {pendingRosterUpload && (
              <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between gap-4">
                <p className="text-sm text-amber-800">
                  A customer roster has been submitted and is ready to import.
                </p>
                <Link
                  href={`/admin/sessions/${session.id}/roster`}
                  className="shrink-0 text-sm font-semibold text-amber-800 underline hover:text-amber-900"
                >
                  Import
                </Link>
              </div>
            )}

            {/* Rollcall info note */}
            <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
              Students register via rollcall at superherocpr.com/rollcall using
              the instructor&apos;s daily class code.
            </div>

            {/* Students table */}
            {totalStudents === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-gray-400">
                No students yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-6 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Name
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Email
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Verified
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Grade
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {/* Rows from bookings (non-cancelled) */}
                    {session.bookings
                      .filter((b) => !b.cancelled)
                      .map((b) => (
                        <tr key={`booking-${b.id}`} className="hover:bg-gray-50">
                          <td className="px-6 py-2.5 font-medium text-gray-800">
                            {b.profiles ? (
                              canUseTools ? (
                                <button
                                  type="button"
                                  onClick={() => openEditBooking(b)}
                                  title="Click to edit contact info"
                                  className="text-left hover:text-red-600 hover:underline transition-colors"
                                >
                                  {b.profiles.first_name} {b.profiles.last_name}
                                </button>
                              ) : (
                                `${b.profiles.first_name} ${b.profiles.last_name}`
                              )
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">
                            {(() => {
                              const emailKeyForContact = b.profiles?.email?.toLowerCase() ?? "";
                              const rosterRecordForContact = rosterRecordByEmail.get(emailKeyForContact);
                              const contactKey = rosterRecordForContact
                                ? rosterRecordForContact.id
                                : `booking-${b.id}`;
                              const override = contactOverrides[contactKey];
                              return override?.email || rosterRecordForContact?.email || b.profiles?.email || "-";
                            })()}
                          </td>
                          <td className="px-4 py-2.5">
                            {(() => {
                              const emailKey = b.profiles?.email?.toLowerCase() ?? "";
                              const rosterRecord = rosterRecordByEmail.get(emailKey);
                              // Resolve verified: prefer local override, then live data
                              const isVerified = rosterRecord
                                ? (confirmedOverrides[rosterRecord.id] ?? rosterRecord.confirmed)
                                : (bookingVerifiedOverrides[b.id] ?? false);
                              const stateKey = rosterRecord ? rosterRecord.id : `b-${b.id}`;
                              const isToggling = togglingVerifiedIds.has(stateKey);
                              const toggleId = rosterRecord?.id ?? b.id;
                              const toggleMode: "roster" | "booking" = rosterRecord ? "roster" : "booking";

                              if (canUseTools) {
                                return (
                                  <button
                                    type="button"
                                    disabled={isToggling}
                                    onClick={() => void handleToggleVerified(toggleMode, toggleId, isVerified)}
                                    title={isVerified ? "Click to mark as not verified" : "Click to mark as verified"}
                                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                                      isVerified
                                        ? "bg-green-100 text-green-700 hover:bg-green-200"
                                        : "bg-red-100 text-red-700 hover:bg-red-200"
                                    }`}
                                  >
                                    {isToggling ? "…" : isVerified ? "YES" : "NO"}
                                  </button>
                                );
                              }
                              return (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                                  isVerified ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                                }`}>
                                  {isVerified ? "YES" : "NO"}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">
                            {/* Prefer grade from the roster_record (where the
                                grading tool saves it) over bookings.grade */}
                            {(rosterGradeByEmail.get(
                              b.profiles?.email?.toLowerCase() ?? ""
                            ) ??
                              b.grade) ??
                              "-"}
                          </td>
                        </tr>
                      ))}
                    {/* Rows from roster records — deduplicated against booking emails */}
                    {uniqueRosterRecords.map((r) => (
                      <tr key={`roster-${r.id}`} className="hover:bg-gray-50">
                        <td className="px-6 py-2.5 font-medium text-gray-800">
                          {canUseTools ? (
                            <button
                              type="button"
                              onClick={() => openEditRoster(r)}
                              title="Click to edit contact info"
                              className="text-left hover:text-red-600 hover:underline transition-colors"
                            >
                              {r.first_name} {r.last_name}
                            </button>
                          ) : (
                            `${r.first_name} ${r.last_name}`
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {contactOverrides[r.id]?.email || r.email || "-"}
                        </td>
                        <td className="px-4 py-2.5">
                          {(() => {
                            const isVerified = confirmedOverrides[r.id] ?? r.confirmed;
                            const isToggling = togglingVerifiedIds.has(r.id);
                            if (canUseTools) {
                              return (
                                <button
                                  type="button"
                                  disabled={isToggling}
                                  onClick={() => void handleToggleVerified("roster", r.id, isVerified)}
                                  title={isVerified ? "Click to mark as not verified" : "Click to mark as verified"}
                                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                                    isVerified
                                      ? "bg-green-100 text-green-700 hover:bg-green-200"
                                      : "bg-red-100 text-red-700 hover:bg-red-200"
                                  }`}
                                >
                                  {isToggling ? "…" : isVerified ? "YES" : "NO"}
                                </button>
                              );
                            }
                            return (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                                isVerified ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                              }`}>
                                {isVerified ? "YES" : "NO"}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {r.grade ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: Tools + Invoices ── */}
        <div className="space-y-6">

          {/* ══ Section 4: Tools ══ */}
          {canUseTools && (
            <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
              <h2 className="text-base font-semibold text-gray-900">Tools</h2>

              {/* Grading tool */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    Grading Tool
                  </span>
                  <span className="text-xs text-gray-500">
                    {gradedCount} / {totalStudents} graded
                  </span>
                </div>
                {session.status === "completed" || session.status === "in_progress" ? (
                  <Link
                    href={`/admin/sessions/${session.id}/grades`}
                    className="block text-center px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors"
                  >
                    Open Grading Tool
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="w-full text-center px-4 py-2 bg-gray-100 text-gray-400 text-sm font-semibold rounded-md cursor-not-allowed"
                    title="Available after session is marked completed"
                  >
                    Open Grading Tool
                  </button>
                )}
              </div>

              {/* Enrollware */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    Enrollware
                  </span>
                  {session.enrollware_submitted && (
                    <span className="text-xs font-medium text-green-600">
                      Submitted
                    </span>
                  )}
                </div>
                <a
                  href="https://www.enrollware.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 transition-colors"
                >
                  Open Enrollware ↗
                </a>
              </div>

              {/* CSV Export — super admin only, completed sessions only */}
              {isSuperAdmin && (
                <div className="space-y-1">
                  <span className="text-sm font-medium text-gray-700">
                    Export Student Data
                  </span>
                  {session.status === "completed" ? (
                    <button
                      type="button"
                      onClick={handleExportCSV}
                      className="w-full text-center px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 transition-colors"
                    >
                      Export CSV
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="w-full text-center px-4 py-2 bg-gray-100 text-gray-400 text-sm font-semibold rounded-md cursor-not-allowed"
                      title="Available after session is marked completed"
                    >
                      Export CSV
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══ Section 3: Invoices ══ */}
          {canSeeInvoices && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <h2 className="text-base font-semibold text-gray-900">
                  Invoices
                </h2>
                <Link
                  href={`/admin/invoices/new?session=${session.id}`}
                  className="text-sm font-medium text-red-600 hover:text-red-700"
                >
                  + Send Invoice
                </Link>
              </div>

              {session.invoices.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  No invoices yet.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {session.invoices.map((inv) => (
                    <li key={inv.id} className="px-5 py-3 hover:bg-gray-50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/admin/invoices/${inv.id}`}
                            className="text-sm font-medium text-red-600 hover:underline"
                          >
                            {inv.invoice_number}
                          </Link>
                          <p className="text-xs text-gray-500 truncate">
                            {inv.company_name ?? inv.recipient_name} ·{" "}
                            {inv.student_count} student
                            {inv.student_count !== 1 ? "s" : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${invoiceStatusBadgeClass(inv.status)}`}
                          >
                            {inv.status}
                          </span>
                          <p className="text-xs text-gray-500 mt-0.5">
                            ${Number(inv.total_amount).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
