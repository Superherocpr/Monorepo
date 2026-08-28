"use client";

/**
 * CreateSessionClient — form UI for creating a new class session.
 * Used by: app/(admin)/admin/sessions/new/page.tsx
 * Managers and super admins can assign any instructor. Instructors always
 * create sessions for themselves and do not see the instructor selector.
 *
 * Also creates team/corporate bookings: toggling "This is a team booking"
 * reveals the company contact and pricing fields, hides add-ons (never offered
 * on team bookings), and submits to /api/team-bookings instead of /api/sessions.
 * On success it shows the shareable signup link to hand to the company contact
 * rather than redirecting to the session detail page.
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AddLocationPanel, { type NewLocationResult } from "@/app/(admin)/_components/AddLocationPanel";
import { toFloatingISO, addFloatingMinutes } from "@/lib/business-time";

/** A class type option for the dropdown. */
export interface ClassTypeOption {
  id: string;
  name: string;
  duration_minutes: number;
  max_capacity: number;
  /** Base price in USD — used for the discount preview. */
  price: number;
  /** IDs of add-ons eligible for this class type (addon_class_types). */
  addon_ids: string[];
}

/** An add-on catalog entry, for the eligible-add-ons checklist. */
export interface AddonOption {
  id: string;
  name: string;
  price: number;
}

/** A location option for the dropdown. */
export interface LocationOption {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
}

/** An instructor option for the dropdown (manager/super admin only). */
export interface InstructorOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface CreateSessionClientProps {
  classTypes: ClassTypeOption[];
  locations: LocationOption[];
  /** Non-empty only for manager and super admin roles. */
  instructors: InstructorOption[];
  /** Full add-on catalog — filtered per class type via ClassTypeOption.addon_ids. */
  addons: AddonOption[];
  /** Whether the viewing user is an instructor (hides instructor selector). */
  isInstructor: boolean;
  /**
   * Full name of the currently logged-in user. Only provided when isInstructor
   * is true — displayed in a read-only row in place of the instructor selector.
   */
  instructorName?: string;
}

/** Form state shape for the create-session form. */
interface SessionForm {
  class_type_id: string;
  instructor_id: string;
  location_id: string;
  /** Local date as YYYY-MM-DD */
  date: string;
  /** Local start time as HH:MM (24-hour) */
  start_time: string;
  /** Duration in hours — auto-filled from class type, editable. Stored as minutes in DB. */
  duration_minutes: string;
  /** Max students — auto-filled from class type, editable */
  max_capacity: string;
  /** Promotional discount as a percentage string (0–50). Empty = no discount. */
  discount_percent: string;
  notes: string;
}

const EMPTY_FORM: SessionForm = {
  class_type_id: "",
  instructor_id: "",
  location_id: "",
  date: "",
  start_time: "",
  duration_minutes: "",
  max_capacity: "",
  discount_percent: "",
  notes: "",
};

/** How a team booking is paid for. */
type TeamPaymentMode = "company" | "per_seat";

/** Company contact and pricing fields, only used when the team toggle is on. */
interface TeamForm {
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  payment_mode: TeamPaymentMode;
  /** Flat total in company mode, per-seat price in per_seat mode. */
  price: string;
}

const EMPTY_TEAM_FORM: TeamForm = {
  company_name: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  payment_mode: "per_seat",
  price: "",
};

/** What the API returns after a team booking is created. */
interface TeamBookingCreated {
  shareUrl: string;
  invoiceNumber: string | null;
  autoApproved: boolean;
  invoiceError?: string;
  sessionId: string;
}

/**
 * Renders the create-session form.
 * Selecting a class type auto-fills duration and capacity (editable).
 * On submit, POSTs to /api/sessions and redirects to the new session detail.
 */
export default function CreateSessionClient({
  classTypes,
  locations,
  instructors,
  addons,
  isInstructor,
  instructorName,
}: CreateSessionClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<SessionForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /**
   * Team/corporate mode. Pre-enabled (with company details filled in) when
   * arriving from the "Convert to team booking" button on a class request.
   */
  const [isTeam, setIsTeam] = useState(searchParams.get("team") === "1");
  const [teamForm, setTeamForm] = useState<TeamForm>(() => ({
    ...EMPTY_TEAM_FORM,
    company_name: searchParams.get("company") ?? "",
    contact_name: searchParams.get("contact") ?? "",
    contact_email: searchParams.get("email") ?? "",
    contact_phone: searchParams.get("phone") ?? "",
  }));
  /** The class request this booking came from, carried through to the API. */
  const classRequestId = searchParams.get("request_id");
  /** Set once a team booking is created — switches the view to the share link. */
  const [created, setCreated] = useState<TeamBookingCreated | null>(null);
  const [copied, setCopied] = useState(false);
  /**
   * Shown after validation passes on a team-booking submit, before it actually
   * goes out — the share-link email fires immediately, so this is the last
   * point to remind the creator they still have to forward it themselves.
   */
  const [showTeamReminder, setShowTeamReminder] = useState(false);
  /** The validated request body, held while the reminder is up. */
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  /** IDs of add-ons selected to offer on this session — narrowed to the selected class type's eligibility. */
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  /** Tracks whether duration and capacity were last populated by the class-type auto-fill. */
  const [autoFilled, setAutoFilled] = useState(false);
  /** Local copy of locations — updated when a new location is added inline so the dropdown refreshes without a page reload. */
  const [locationList, setLocationList] = useState<LocationOption[]>(locations);
  /** Controls whether the Add Location slide-out panel is visible. */
  const [showAddLocationPanel, setShowAddLocationPanel] = useState(false);
  /**
   * Whether the discount field represents a percentage or a fixed dollar amount.
   * The raw value in form.discount_percent is interpreted accordingly.
   * On submit, fixed amounts are converted to a percentage before sending to the API.
   */
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");

  /**
   * Updates a single form field by name.
   * @param field - The SessionForm key to update.
   * @param value - New string value for that field.
   */
  function setField(field: keyof SessionForm, value: string) {
    // If the user manually edits duration or capacity, clear the auto-filled indicator.
    if (field === "duration_minutes" || field === "max_capacity") setAutoFilled(false);
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Updates a single team-form field by name.
   * @param field - The TeamForm key to update.
   * @param value - New value for that field.
   */
  function setTeamField(field: keyof TeamForm, value: string) {
    setTeamForm((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Copies the generated share link to the clipboard and flashes confirmation.
   * Side effects: writes to the system clipboard.
   */
  async function copyShareUrl(): Promise<void> {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the URL is visible on screen regardless.
    }
  }

  /**
   * When the user picks a class type, auto-fill duration and capacity
   * from the selected type's defaults. Values remain editable.
   * @param id - The selected class_type_id.
   */
  function handleClassTypeChange(id: string) {
    const type = classTypes.find((t) => t.id === id);
    setForm((prev) => ({
      ...prev,
      class_type_id: id,
      duration_minutes: type ? String(type.duration_minutes / 60) : prev.duration_minutes,
      max_capacity: type ? String(type.max_capacity) : prev.max_capacity,
    }));
    // Show the auto-filled hint below the duration and capacity fields.
    if (type) setAutoFilled(true);
    // Drop any selected add-ons that aren't eligible for the newly selected class type.
    setSelectedAddonIds((prev) => prev.filter((addonId) => type?.addon_ids.includes(addonId)));
  }

  /** Adds or removes an addon ID from the selected set. */
  function toggleAddon(id: string) {
    setSelectedAddonIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]
    );
  }

  /**
   * Switches between percent and fixed-dollar discount modes, converting the
   * current field value to the equivalent in the new mode when a class type
   * with a known price is selected. Clears the value when conversion is not
   * possible (no class selected or price is zero).
   */
  function handleDiscountTypeToggle(): void {
    const newType = discountType === "percent" ? "fixed" : "percent";
    const currentPrice = classTypes.find((t) => t.id === form.class_type_id)?.price ?? null;
    const rawValue = parseFloat(form.discount_percent);

    if (!isNaN(rawValue) && form.discount_percent !== "" && currentPrice !== null && currentPrice > 0) {
      if (newType === "fixed") {
        // percent → dollar: e.g. 25 on a $100 class → 25.00
        const fixed = (rawValue / 100) * currentPrice;
        setField("discount_percent", fixed % 1 === 0 ? String(fixed) : fixed.toFixed(2));
      } else {
        // dollar → percent: e.g. 25.00 on a $100 class → 25
        const pct = (rawValue / currentPrice) * 100;
        setField("discount_percent", pct % 1 === 0 ? String(pct) : parseFloat(pct.toFixed(2)).toString());
      }
    } else {
      setField("discount_percent", "");
    }

    setDiscountType(newType);
  }

  /**
   * Validates the form and builds starts_at/ends_at timestamps and the request
   * payload. A regular session submits immediately via submitPayload(); a team
   * booking instead shows the share-link reminder and waits for confirmation
   * before submitPayload() is called.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side validation before hitting the API
    if (!form.class_type_id) {
      setError("Please select a class type.");
      return;
    }
    if (!isInstructor && !form.instructor_id) {
      setError("Please select an instructor.");
      return;
    }
    if (!form.location_id) {
      setError("Please select a location.");
      return;
    }
    if (!form.date || !form.start_time) {
      setError("Please enter a date and start time.");
      return;
    }
    const durationHours = parseFloat(form.duration_minutes);
    if (!form.duration_minutes || isNaN(durationHours) || durationHours <= 0) {
      setError("Please enter a valid duration.");
      return;
    }
    const durationMin = Math.round(durationHours * 60);
    const capacity = parseInt(form.max_capacity, 10);
    if (!form.max_capacity || isNaN(capacity) || capacity < 1) {
      setError("Please enter a valid max capacity.");
      return;
    }

    // Resolve the class price for discount validation.
    const classPrice = classTypes.find((t) => t.id === form.class_type_id)?.price ?? null;

    let resolvedDiscountPercent: number | null = null;

    if (form.discount_percent !== "") {
      const rawDiscount = parseFloat(form.discount_percent);
      if (isNaN(rawDiscount) || rawDiscount < 0) {
        setError(discountType === "percent" ? "Discount must be 0% or greater." : "Discount amount must be 0 or greater.");
        return;
      }

      if (discountType === "percent") {
        if (rawDiscount > 50) {
          setError("Discount cannot exceed 50% — the final price must be at least 50% of the class price.");
          return;
        }
        resolvedDiscountPercent = rawDiscount;
      } else {
        // Fixed dollar mode: cap at 50% of the class price.
        if (classPrice !== null && rawDiscount > classPrice * 0.5) {
          const maxFixed = (classPrice * 0.5).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          setError(`Fixed discount cannot exceed $${maxFixed} — the final price must be at least 50% of the class price.`);
          return;
        }
        // Convert to percent for the API; skip if the class has no price.
        if (classPrice !== null && classPrice > 0) {
          resolvedDiscountPercent = (rawDiscount / classPrice) * 100;
        }
      }
    }

    // Final guard: ensure the discounted price is never below 50% of the class price.
    if (resolvedDiscountPercent !== null && resolvedDiscountPercent > 50) {
      setError("The discount cannot bring the final price below 50% of the class price.");
      return;
    }

    // ── Team-mode validation ────────────────────────────────────────────────
    let teamPrice: number | null = null;
    if (isTeam) {
      if (!teamForm.company_name.trim()) {
        setError("Please enter the company name.");
        return;
      }
      if (!teamForm.contact_name.trim()) {
        setError("Please enter the contact's name.");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(teamForm.contact_email.trim())) {
        setError("Please enter a valid contact email.");
        return;
      }
      if (!teamForm.contact_phone.trim()) {
        setError("Please enter the contact's phone number.");
        return;
      }
      teamPrice = parseFloat(teamForm.price);
      if (teamForm.price === "" || isNaN(teamPrice) || teamPrice < 0) {
        setError(
          teamForm.payment_mode === "company"
            ? "Please enter the total price the company is paying."
            : "Please enter the price each employee pays."
        );
        return;
      }
      if (teamForm.payment_mode === "company" && teamPrice <= 0) {
        setError("The company total must be greater than zero.");
        return;
      }
    }

    // Stored as floating wall-clock time — the time entered here is the time
    // shown everywhere, with no timezone conversion. See lib/business-time.ts.
    const starts_at = toFloatingISO(form.date, form.start_time);
    const ends_at = addFloatingMinutes(starts_at, durationMin);

    const payload: Record<string, unknown> = {
      class_type_id: form.class_type_id,
      location_id: form.location_id,
      starts_at,
      ends_at,
      max_capacity: capacity,
      discount_percent: resolvedDiscountPercent,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      addon_ids: selectedAddonIds,
    };

    // Instructors omit instructor_id — server resolves it from their own profile.
    if (!isInstructor) {
      payload.instructor_id = form.instructor_id;
    }

    // Team bookings carry the company details and never offer add-ons.
    if (isTeam) {
      delete payload.addon_ids;
      payload.company_name = teamForm.company_name.trim();
      payload.contact_name = teamForm.contact_name.trim();
      payload.contact_email = teamForm.contact_email.trim();
      payload.contact_phone = teamForm.contact_phone.trim();
      payload.payment_mode = teamForm.payment_mode;
      if (teamForm.payment_mode === "company") {
        payload.total_price = teamPrice;
      } else {
        payload.price_per_seat = teamPrice;
      }
      if (classRequestId) payload.class_request_id = classRequestId;
    }

    // Team bookings pause here for a confirmation: creating this immediately
    // emails the creator the share link (not the company contact — the creator
    // has to forward it themselves), and for a manager/super admin the class
    // goes live right away. Regular sessions submit straight through as before.
    if (isTeam) {
      setPendingPayload(payload);
      setShowTeamReminder(true);
      return;
    }

    await submitPayload(payload);
  }

  /**
   * Posts the validated payload to the appropriate endpoint and handles the
   * response — team bookings show the share link, regular sessions redirect
   * to the new session's detail page.
   * @param payload - The request body built and validated by handleSubmit.
   */
  async function submitPayload(payload: Record<string, unknown>): Promise<void> {
    setLoading(true);

    try {
      const res = await fetch(isTeam ? "/api/team-bookings" : "/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data: unknown = await res.json();

      if (!res.ok) {
        const msg =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: string }).error)
            : "Failed to create session. Please try again.";
        setError(msg);
        setLoading(false);
        return;
      }

      // ── Team booking: show the share link instead of redirecting ──────────
      if (isTeam) {
        const result = data as {
          shareToken?: string;
          sessionId?: string;
          invoiceNumber?: string | null;
          autoApproved?: boolean;
          invoiceError?: string;
        };

        if (!result.shareToken) {
          setError("Team booking created but no link was returned. Check the sessions list.");
          setLoading(false);
          return;
        }

        setCreated({
          shareUrl: `${window.location.origin}/team/${result.shareToken}`,
          invoiceNumber: result.invoiceNumber ?? null,
          autoApproved: result.autoApproved ?? false,
          invoiceError: result.invoiceError,
          sessionId: result.sessionId ?? "",
        });
        setLoading(false);
        return;
      }

      const newId =
        typeof data === "object" && data !== null && "id" in data
          ? String((data as { id: string }).id)
          : null;

      if (!newId) {
        setError("Session created but could not redirect. Check the sessions list.");
        setLoading(false);
        return;
      }

      // Navigate to the new session detail page
      router.push(`/admin/sessions/${newId}`);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  }

  // ── Derived display values ─────────────────────────────────────────────────

  /**
   * True when the selected date + start time resolve to a moment in the past.
   * Used to show an amber warning banner — non-blocking so managers can still
   * create historical sessions intentionally.
   */
  const isPastSession =
    !!form.date &&
    !!form.start_time &&
    new Date(`${form.date}T${form.start_time}:00`) < new Date();

  // ── Discount price preview ─────────────────────────────────────────────────

  /** Base price of the currently selected class type. Null when no class type is selected. */
  const selectedClassTypePrice = classTypes.find((t) => t.id === form.class_type_id)?.price ?? null;

  /**
   * Parsed discount percentage for preview (percent mode only).
   * Null when the field is empty, invalid, or mode is fixed.
   */
  const parsedDiscountPreview = (() => {
    if (discountType !== "percent" || !form.discount_percent) return null;
    const n = parseFloat(form.discount_percent);
    return isNaN(n) || n <= 0 || n > 50 ? null : n;
  })();

  /**
   * Parsed fixed dollar discount for preview (fixed mode only).
   * Null when the field is empty, invalid, exceeds 50% of class price, or mode is percent.
   */
  const parsedFixedPreview = (() => {
    if (discountType !== "fixed" || !form.discount_percent) return null;
    const n = parseFloat(form.discount_percent);
    if (isNaN(n) || n <= 0) return null;
    if (selectedClassTypePrice !== null && n > selectedClassTypePrice * 0.5) return null;
    return n;
  })();

  /**
   * Shows the equivalent minutes when the user enters hours — helps verify the duration.
   * e.g. "1.5" → "= 90 min". Returns null when the field is empty or invalid.
   */
  const durationHint = (() => {
    const hours = parseFloat(form.duration_minutes);
    if (!form.duration_minutes || isNaN(hours) || hours <= 0) return null;
    const mins = Math.round(hours * 60);
    return `= ${mins} min`;
  })();

  // ── Success view: the team share link to hand to the company contact ──────
  if (created) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-green-100 text-green-700 flex items-center justify-center shrink-0 font-bold">
              ✓
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Team booking created</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Send this link to {teamForm.contact_name.trim() || "the company contact"} — they
                share it with their own staff.
              </p>
            </div>
          </div>

          {!created.autoApproved && (
            <div
              role="status"
              className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm"
            >
              This class still needs manager approval before the link will accept signups. Hold off
              on sending it until it&apos;s approved.
            </div>
          )}

          {created.invoiceError && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm"
            >
              The booking was created, but the invoice could not be sent: {created.invoiceError} You
              can raise it manually from the Invoices page.
            </div>
          )}

          {created.invoiceNumber && (
            <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm">
              Invoice <strong>{created.invoiceNumber}</strong> has been emailed to{" "}
              {teamForm.contact_email.trim()}. Employees can sign up before it&apos;s paid.
            </div>
          )}

          {/* Share link + copy */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cs-share-url" className="text-sm font-medium text-gray-700">
              Signup link
            </label>
            <div className="flex gap-2">
              <input
                id="cs-share-url"
                readOnly
                value={created.shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="button"
                onClick={copyShareUrl}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Anyone with this link can sign up, and it also shows them who has signed up so far.
            </p>
          </div>

          <div className="pt-2 flex flex-col gap-3">
            {created.sessionId && (
              <Link
                href={`/admin/sessions/${created.sessionId}`}
                className="w-full text-center bg-gray-800 hover:bg-gray-900 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
              >
                View the class
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                setCreated(null);
                setForm(EMPTY_FORM);
                setTeamForm(EMPTY_TEAM_FORM);
                setSelectedAddonIds([]);
              }}
              className="text-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Create another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isTeam ? "Create Team Booking" : "Create New Class Session"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isTeam
              ? "Creates a private class plus a signup link to hand to the company contact."
              : "New sessions are submitted for approval before appearing on the public schedule."}
          </p>
        </div>
        <Link
          href="/admin/sessions"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Back to sessions
        </Link>
      </div>

      {/* Bulk creation prompt — not relevant while building a single team booking */}
      {!isTeam && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-600 flex items-center justify-between">
          <span>Scheduling multiple sessions at once?</span>
          <Link
            href="/admin/sessions/bulk"
            className="font-medium text-red-600 hover:text-red-700 transition-colors whitespace-nowrap ml-4"
          >
            Use the bulk creator →
          </Link>
        </div>
      )}

      {/* Team/corporate toggle — switches this form between the two modes */}
      <label className="flex items-start gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3 cursor-pointer">
        <input
          type="checkbox"
          checked={isTeam}
          onChange={(e) => {
            setIsTeam(e.target.checked);
            setError(null);
          }}
          className="mt-0.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
        />
        <span>
          <span className="block text-sm font-medium text-gray-900">
            This is a team / corporate booking
          </span>
          <span className="block text-xs text-gray-500 mt-0.5">
            Creates a private class (hidden from the public schedule) plus a signup link for the
            company&apos;s employees.
          </span>
        </span>
      </label>

      {/* ── Form ── */}
      <form
        onSubmit={handleSubmit}
        noValidate
        className="bg-white border border-gray-200 rounded-xl p-6 space-y-5"
      >
        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm"
          >
            {error}
          </div>
        )}

        {/* Past-date warning — informational only, does not block submission */}
        {isPastSession && (
          <div
            role="status"
            className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm"
          >
            This session is scheduled in the past — double-check the date and time before submitting.
          </div>
        )}

        {/* ── Company details + pricing (team mode only) ── */}
        {isTeam && (
          <div className="space-y-4 border border-gray-200 rounded-lg p-4 bg-gray-50">
            <p className="text-sm font-semibold text-gray-900">Company details</p>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cs-company" className="text-sm font-medium text-gray-700">
                Company Name <span className="text-red-500">*</span>
              </label>
              <input
                id="cs-company"
                type="text"
                value={teamForm.company_name}
                onChange={(e) => setTeamField("company_name", e.target.value)}
                placeholder="e.g. Acme Hospital"
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cs-contact-name" className="text-sm font-medium text-gray-700">
                  Contact Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="cs-contact-name"
                  type="text"
                  value={teamForm.contact_name}
                  onChange={(e) => setTeamField("contact_name", e.target.value)}
                  placeholder="Who you spoke with"
                  className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="cs-contact-phone" className="text-sm font-medium text-gray-700">
                  Contact Phone <span className="text-red-500">*</span>
                </label>
                <input
                  id="cs-contact-phone"
                  type="tel"
                  required
                  value={teamForm.contact_phone}
                  onChange={(e) => setTeamField("contact_phone", e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cs-contact-email" className="text-sm font-medium text-gray-700">
                Contact Email <span className="text-red-500">*</span>
              </label>
              <input
                id="cs-contact-email"
                type="email"
                value={teamForm.contact_email}
                onChange={(e) => setTeamField("contact_email", e.target.value)}
                placeholder="Where the invoice and link go"
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            {/* Payment mode — decides who gets billed and what employees see */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-gray-700">Who is paying?</span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      mode: "per_seat" as const,
                      title: "Each employee",
                      blurb: "They pay when they sign up",
                    },
                    {
                      mode: "company" as const,
                      title: "The company",
                      blurb: "Invoiced a flat total",
                    },
                  ]
                ).map(({ mode, title, blurb }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTeamField("payment_mode", mode)}
                    className={[
                      "text-left px-3 py-2.5 rounded-lg border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                      teamForm.payment_mode === mode
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-white text-gray-700 border-gray-300 hover:border-red-400",
                    ].join(" ")}
                  >
                    <span className="block text-sm font-semibold">{title}</span>
                    <span
                      className={[
                        "block text-xs mt-0.5",
                        teamForm.payment_mode === mode ? "text-red-100" : "text-gray-500",
                      ].join(" ")}
                    >
                      {blurb}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cs-team-price" className="text-sm font-medium text-gray-700">
                {teamForm.payment_mode === "company" ? "Total Price" : "Price Per Seat"}{" "}
                <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 select-none">$</span>
                <input
                  id="cs-team-price"
                  type="number"
                  min={0}
                  step={0.01}
                  value={teamForm.price}
                  onChange={(e) => setTeamField("price", e.target.value)}
                  placeholder={teamForm.payment_mode === "company" ? "e.g. 1200.00" : "e.g. 80.00"}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <p className="text-xs text-gray-400">
                {teamForm.payment_mode === "company"
                  ? "The company is invoiced this flat amount. Employees sign up free, and can do so before it's paid."
                  : "What each employee pays at signup. This replaces the standard class price. Promo codes still apply."}
              </p>
            </div>
          </div>
        )}

        {/* Class Type */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cs-class-type" className="text-sm font-medium text-gray-700">
            Class Type <span className="text-red-500">*</span>
          </label>
          <select
            id="cs-class-type"
            value={form.class_type_id}
            onChange={(e) => handleClassTypeChange(e.target.value)}
            required
            className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          >
            <option value="">Select a class type…</option>
            {classTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* Instructor — selector for managers; read-only display for instructors */}
        {!isInstructor ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cs-instructor" className="text-sm font-medium text-gray-700">
              Instructor <span className="text-red-500">*</span>
            </label>
            <select
              id="cs-instructor"
              value={form.instructor_id}
              onChange={(e) => setField("instructor_id", e.target.value)}
              required
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            >
              <option value="">Select an instructor…</option>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.first_name} {i.last_name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          /* Instructors always create sessions for themselves — confirm who that is. */
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-gray-700">Instructor</span>
            <div className="border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-sm text-gray-700">
              {instructorName ?? "You"}
            </div>
          </div>
        )}

        {/* Location */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="cs-location" className="text-sm font-medium text-gray-700">
              Location <span className="text-red-500">*</span>
            </label>
            <button
              type="button"
              onClick={() => setShowAddLocationPanel(true)}
              className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
            >
              + Add Location
            </button>
          </div>
          <select
            id="cs-location"
            value={form.location_id}
            onChange={(e) => setField("location_id", e.target.value)}
            required
            className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          >
            <option value="">Select a location…</option>
            {locationList.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} — {l.city}, {l.state}
              </option>
            ))}
          </select>
        </div>

        {/* Date + Start time — side by side */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cs-date" className="text-sm font-medium text-gray-700">
              Date <span className="text-red-500">*</span>
            </label>
            <input
              id="cs-date"
              type="date"
              value={form.date}
              onChange={(e) => setField("date", e.target.value)}
              required
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cs-start-time" className="text-sm font-medium text-gray-700">
              Start Time <span className="text-red-500">*</span>
            </label>
            <input
              id="cs-start-time"
              type="time"
              value={form.start_time}
              onChange={(e) => setField("start_time", e.target.value)}
              required
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Duration + Capacity — side by side */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cs-duration" className="text-sm font-medium text-gray-700">
                Duration (hours) <span className="text-red-500">*</span>
              </label>
              <input
                id="cs-duration"
                type="number"
                min={0.25}
                step={0.25}
                value={form.duration_minutes}
                onChange={(e) => setField("duration_minutes", e.target.value)}
                required
                placeholder="e.g. 2"
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              {/* Computed hours — helps staff verify the duration at a glance */}
              {durationHint && (
                <p className="text-xs text-gray-400">{durationHint}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cs-capacity" className="text-sm font-medium text-gray-700">
                Max Capacity <span className="text-red-500">*</span>
              </label>
              <input
                id="cs-capacity"
                type="number"
                min={1}
                value={form.max_capacity}
                onChange={(e) => setField("max_capacity", e.target.value)}
                required
                placeholder="e.g. 20"
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Auto-filled hint — clears when the user manually edits either field */}
          {autoFilled && (
            <p className="text-xs text-gray-400">
              Duration and capacity were auto-filled from the class type — edit if needed.
            </p>
          )}
        </div>

        {/* Discount (optional) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Discount{" "}
              <span className="text-gray-400 font-normal">
                {discountType === "percent"
                  ? "(optional, max 50%)"
                  : selectedClassTypePrice !== null
                    ? `(optional, max $${(selectedClassTypePrice * 0.5).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                    : "(optional — select a class type first)"}
              </span>
            </label>
            {parsedDiscountPreview !== null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                {parsedDiscountPreview}% OFF
              </span>
            )}
            {parsedFixedPreview !== null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                ${parsedFixedPreview.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} OFF
              </span>
            )}
          </div>

          {/* Quick-pick shortcut buttons + % / $ mode toggle */}
          <div className="flex gap-2">
            {([10, 20, 25, 50] as const).map((pct) => {
              // In fixed mode show the dollar equivalent when a class type is selected.
              const fixedEquiv =
                discountType === "fixed" && selectedClassTypePrice !== null
                  ? (pct / 100) * selectedClassTypePrice
                  : null;
              const label =
                fixedEquiv !== null
                  ? `$${fixedEquiv % 1 === 0 ? fixedEquiv : fixedEquiv.toFixed(2)}`
                  : `${pct}%`;
              const setValue =
                fixedEquiv !== null
                  ? (fixedEquiv % 1 === 0 ? String(fixedEquiv) : fixedEquiv.toFixed(2))
                  : String(pct);
              const isSelected =
                discountType === "fixed" && fixedEquiv !== null
                  ? parseFloat(form.discount_percent) === fixedEquiv
                  : form.discount_percent === String(pct);
              const isDisabled = discountType === "fixed" && selectedClassTypePrice === null;

              return (
                <button
                  key={pct}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setField("discount_percent", setValue)}
                  className={[
                    "flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                    isDisabled
                      ? "opacity-40 cursor-not-allowed bg-white text-gray-400 border-gray-200"
                      : isSelected
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-white text-gray-700 border-gray-300 hover:border-red-400 hover:text-red-600",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}

            {/* % / $ pill toggle — switches discount input between percent and fixed dollar */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => discountType !== "percent" && handleDiscountTypeToggle()}
                className={[
                  "px-3 py-2 text-sm font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                  discountType === "percent"
                    ? "bg-gray-800 text-white"
                    : "bg-white text-gray-500 hover:bg-gray-50",
                ].join(" ")}
                title="Percentage discount"
              >
                %
              </button>
              <button
                type="button"
                onClick={() => discountType !== "fixed" && handleDiscountTypeToggle()}
                className={[
                  "px-3 py-2 text-sm font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                  discountType === "fixed"
                    ? "bg-gray-800 text-white"
                    : "bg-white text-gray-500 hover:bg-gray-50",
                ].join(" ")}
                title="Fixed dollar discount"
              >
                $
              </button>
            </div>
          </div>

          {/* Custom discount input — adapts label and constraints to the active mode */}
          <div className="flex items-center gap-2">
            {discountType === "fixed" && (
              <span className="text-sm text-gray-500 select-none">$</span>
            )}
            <input
              id="cs-discount"
              type="number"
              min={0}
              max={
                discountType === "percent"
                  ? 50
                  : selectedClassTypePrice !== null
                    ? selectedClassTypePrice * 0.5
                    : undefined
              }
              step={discountType === "percent" ? 1 : 0.01}
              value={form.discount_percent}
              onChange={(e) => {
                const raw = e.target.value;
                if (discountType === "percent") {
                  // Allow clearing; clamp to 50 on blur, not on keystroke, so typing feels natural.
                  if (raw === "" || parseFloat(raw) <= 50) {
                    setField("discount_percent", raw);
                  }
                } else {
                  // Fixed mode: allow any non-negative value; enforce max on blur.
                  if (raw === "" || parseFloat(raw) >= 0) {
                    setField("discount_percent", raw);
                  }
                }
              }}
              onBlur={() => {
                const n = parseFloat(form.discount_percent);
                if (isNaN(n)) return;
                if (discountType === "percent" && n > 50) {
                  setField("discount_percent", "50");
                } else if (discountType === "fixed" && selectedClassTypePrice !== null && n > selectedClassTypePrice * 0.5) {
                  setField("discount_percent", (selectedClassTypePrice * 0.5).toFixed(2));
                }
              }}
              placeholder={
                discountType === "percent"
                  ? "Custom % (0 – 50)"
                  : selectedClassTypePrice !== null
                    ? `Max $${(selectedClassTypePrice * 0.5).toFixed(2)}`
                    : "Select a class type first"
              }
              disabled={discountType === "fixed" && selectedClassTypePrice === null}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:opacity-40 disabled:cursor-not-allowed"
            />
            {discountType === "percent" && (
              <span className="text-sm text-gray-500 select-none">%</span>
            )}
            {form.discount_percent && (
              <button
                type="button"
                onClick={() => setField("discount_percent", "")}
                className="text-xs text-gray-400 hover:text-red-600 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 rounded"
              >
                Clear
              </button>
            )}
          </div>

          {/* Live price preview — shown when a class type with a price is selected and a valid discount is entered */}
          {selectedClassTypePrice !== null && parsedDiscountPreview !== null && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              Price per person:{" "}
              <span className="line-through text-gray-400 mr-1">
                {selectedClassTypePrice === 0
                  ? "Free"
                  : `$${selectedClassTypePrice.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
              </span>
              <span className="font-semibold">
                {selectedClassTypePrice === 0
                  ? "Free"
                  : `$${(selectedClassTypePrice * (1 - parsedDiscountPreview / 100)).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
              </span>
            </p>
          )}
          {selectedClassTypePrice !== null && parsedFixedPreview !== null && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              Price per person:{" "}
              <span className="line-through text-gray-400 mr-1">
                ${selectedClassTypePrice.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </span>
              <span className="font-semibold">
                ${(selectedClassTypePrice - parsedFixedPreview).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </span>
            </p>
          )}
        </div>

        {/* Add-ons (optional) — only shown once a class type with eligible add-ons
            is selected. Never offered on team bookings: the price is a flat or
            per-seat rate negotiated with the company. */}
        {!isTeam && (() => {
          const eligibleAddonIds = classTypes.find((t) => t.id === form.class_type_id)?.addon_ids ?? [];
          const eligibleAddons = addons.filter((a) => eligibleAddonIds.includes(a.id));
          if (eligibleAddons.length === 0) return null;
          return (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-gray-700">
                Add-ons <span className="text-gray-400 font-normal">(optional)</span>
              </p>
              <p className="text-xs text-gray-400">
                Which add-ons customers can purchase for this specific session.
              </p>
              <div className="space-y-2 border border-gray-200 rounded-lg p-3">
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
            </div>
          );
        })()}

        {/* Notes (optional) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cs-notes" className="text-sm font-medium text-gray-700">
            Notes <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="cs-notes"
            value={form.notes}
            onChange={(e) => setField("notes", e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Any additional details for this session…"
            className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
          />
          {/* Character counter — appears once the user starts typing */}
          {form.notes.length > 0 && (
            <p className="text-xs text-gray-400 text-right">{form.notes.length}/500</p>
          )}
        </div>

        {/* Submit + Cancel */}
        <div className="pt-2 flex flex-col gap-3">
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            {loading
              ? isTeam
                ? "Creating team booking…"
                : "Creating session…"
              : isTeam
                ? "Create Team Booking & Get Link"
                : "Submit for Approval"}
          </button>
          <Link
            href="/admin/sessions"
            className="block text-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* Add Location slide-out panel — rendered outside the form to avoid nested form issues */}
      {showAddLocationPanel && (
        <AddLocationPanel
          onClose={() => setShowAddLocationPanel(false)}
          onAdded={(location: NewLocationResult) => {
            // Add to dropdown list (sorted) and auto-select the new location.
            const option: LocationOption = {
              id: location.id,
              name: location.name,
              address: location.address,
              city: location.city,
              state: location.state,
            };
            setLocationList((prev) =>
              [...prev, option].sort((a, b) => a.name.localeCompare(b.name))
            );
            setField("location_id", location.id);
          }}
        />
      )}

      {/* Team-booking submit reminder — the share-link email fires immediately
          on creation, and it goes to the creator, not the company contact, so
          this is the last chance to remind them they still have to forward it. */}
      {showTeamReminder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full space-y-3">
            <h2 className="text-base font-semibold text-gray-900">
              Don&apos;t forget to send the link
            </h2>
            <p className="text-sm text-gray-600">
              {isTeam && isInstructor ? (
                <>
                  You&apos;ll get an email with this class&apos;s signup link — look for it in
                  your inbox. We don&apos;t send it to the company contact automatically, so
                  forward it to them yourself. This class still needs manager approval
                  before anyone can sign up, so don&apos;t send it out until it&apos;s
                  approved.
                </>
              ) : (
                <>
                  You&apos;ll get an email with this class&apos;s signup link — look for it in
                  your inbox. We don&apos;t send it to the company contact automatically, so
                  forward it to them yourself. This class goes live as soon as you submit,
                  so people can start signing up the moment you send it.
                </>
              )}
            </p>
            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowTeamReminder(false);
                  setPendingPayload(null);
                }}
                className="flex-1 border border-gray-300 text-gray-700 font-semibold py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm"
              >
                Go back and check
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTeamReminder(false);
                  if (pendingPayload) void submitPayload(pendingPayload);
                  setPendingPayload(null);
                }}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
              >
                Yes, create it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
