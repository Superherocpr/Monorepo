/**
 * CustomerDetailClient — client component for the admin customer detail page.
 * Used by: app/(admin)/admin/customers/[id]/page.tsx
 *
 * Renders the full customer view: profile header, inline editable fields,
 * and five tabs (Bookings, Certifications, Orders, Payments, Notes).
 * All data is pre-loaded — tabs switch instantly with no additional fetches.
 * Mutations call API routes then router.refresh() to reload server data.
 */
"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  X,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { UserRole } from "@/types/users";

// ── Data types ────────────────────────────────────────────────────────────────

/** A customer profile with all editable fields. */
interface CustomerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  role: UserRole;
  archived: boolean;
  archived_at: string | null;
  created_at: string;
  customer_notes: string | null;
}

/** A booking row with joined session, instructor, location, and payment data. */
interface BookingRow {
  id: string;
  booking_source: string;
  cancelled: boolean;
  cancellation_note: string | null;
  cancelled_by: string | null;
  manual_booking_reason: string | null;
  created_by: string | null;
  grade: number | null;
  created_at: string;
  class_sessions: {
    id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    class_types: { name: string };
    locations: { name: string; city: string; state: string };
    profiles: { first_name: string; last_name: string };
  };
  payments: {
    id: string;
    amount: number;
    status: string;
    payment_type: string;
    created_at: string;
  }[];
}

/** A certification row with cert type and originating session. */
interface CertRow {
  id: string;
  issued_at: string;
  expires_at: string;
  cert_number: string | null;
  notes: string | null;
  cert_types: { name: string; issuing_body: string | null; validity_months: number };
  class_sessions: { starts_at: string; class_types: { name: string } } | null;
}

/** A merch order with line items. */
interface OrderRow {
  id: string;
  status: string;
  total_amount: number;
  tracking_number: string | null;
  shipping_name: string;
  shipping_address: string;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  created_at: string;
  order_items: {
    quantity: number;
    price_at_purchase: number;
    product_variants: { size: string; products: { name: string } };
  }[];
}

/** A payment row with linked booking/session info. */
interface PaymentRow {
  id: string;
  amount: number;
  status: string;
  payment_type: string;
  paypal_transaction_id: string | null;
  notes: string | null;
  created_at: string;
  logged_by: string | null;
  bookings: {
    class_sessions: { starts_at: string; class_types: { name: string } };
  } | null;
}

/** An upcoming approved session with spots remaining, for the Add Booking panel. */
interface AvailableSession {
  id: string;
  starts_at: string;
  ends_at: string;
  spotsRemaining: number;
  class_types: { name: string };
  locations: { name: string; city: string; state: string };
}

/** An active cert type, for the Issue Cert panel. */
interface CertType {
  id: string;
  name: string;
  issuing_body: string | null;
  validity_months: number;
}

/** All data passed from the server component. */
export interface CustomerDetailData {
  profile: CustomerProfile;
  bookings: BookingRow[];
  certifications: CertRow[];
  orders: OrderRow[];
  payments: PaymentRow[];
  availableSessions: AvailableSession[];
  certTypes: CertType[];
  actorRole: UserRole;
  actorId: string;
}

type Tab = "bookings" | "certifications" | "orders" | "payments" | "notes";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats an ISO date string as a short human-readable date.
 * @param iso - ISO date string.
 */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Formats an ISO date string as a time string.
 * @param iso - ISO date string.
 */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Returns days remaining until an expiry date (negative if already expired).
 * @param expiresAt - ISO date string for the expiry date.
 */
function daysUntilExpiry(expiresAt: string): number {
  const now = new Date();
  const expiry = new Date(expiresAt);
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns the Tailwind class for the cert expiry badge based on days remaining.
 * @param days - Days until expiry (negative means already expired).
 */
function certBadgeClass(days: number): string {
  if (days < 0) return "bg-red-100 text-red-700";
  if (days <= 90) return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}

/**
 * Returns the label for the cert expiry badge.
 * @param days - Days until expiry.
 */
function certBadgeLabel(days: number): string {
  if (days < 0) return "Expired";
  if (days <= 90) return `Expires in ${days}d`;
  return `Valid · ${fmtDate(new Date(Date.now() + days * 86400000).toISOString())}`;
}

/**
 * Returns a badge class for an order status.
 * @param status - Order status string.
 */
function orderStatusClass(status: string): string {
  switch (status) {
    case "paid":
      return "bg-blue-100 text-blue-700";
    case "shipped":
      return "bg-purple-100 text-purple-700";
    case "delivered":
      return "bg-green-100 text-green-700";
    case "cancelled":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

/**
 * Returns a badge class for a payment type.
 * @param type - Payment type string.
 */
function paymentTypeClass(type: string): string {
  switch (type) {
    case "online":
      return "bg-blue-100 text-blue-700";
    case "cash":
      return "bg-green-100 text-green-700";
    case "check":
      return "bg-yellow-100 text-yellow-700";
    case "deposit":
      return "bg-purple-100 text-purple-700";
    case "invoice":
      return "bg-orange-100 text-orange-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

/** Full customer detail page client component. Manages tabs, mutations, and inline forms. */
export default function CustomerDetailClient({
  data,
}: {
  data: CustomerDetailData;
}) {
  const {
    profile: initialProfile,
    bookings,
    certifications,
    orders,
    payments,
    availableSessions,
    certTypes,
    actorRole,
    actorId,
  } = data;

  const router = useRouter();
  const canAct = actorRole === "manager" || actorRole === "super_admin";
  const isSuperAdmin = actorRole === "super_admin";

  // ── Tab state ───────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("bookings");

  // ── Profile edit state ──────────────────────────────────────────────────────
  const [profileValues, setProfileValues] = useState({
    first_name: initialProfile.first_name,
    last_name: initialProfile.last_name,
    email: initialProfile.email,
    phone: initialProfile.phone ?? "",
    address: initialProfile.address ?? "",
    city: initialProfile.city ?? "",
    state: initialProfile.state ?? "",
    zip: initialProfile.zip ?? "",
  });
  const [fieldSaving, setFieldSaving] = useState<string | null>(null);
  const [passwordResetMsg, setPasswordResetMsg] = useState<string | null>(null);
  const [passwordResetSending, setPasswordResetSending] = useState(false);

  // ── Archive state ───────────────────────────────────────────────────────────
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  // ── Bookings tab state ──────────────────────────────────────────────────────
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [showAddBookingPanel, setShowAddBookingPanel] = useState(false);
  const [addSessionId, setAddSessionId] = useState("");
  const [addBookingReason, setAddBookingReason] = useState("");
  const [isAddingBooking, setIsAddingBooking] = useState(false);
  const [addBookingError, setAddBookingError] = useState<string | null>(null);
  const [cancelledOpen, setCancelledOpen] = useState(false);

  // ── Certifications tab state ────────────────────────────────────────────────
  const [showIssueCertPanel, setShowIssueCertPanel] = useState(false);
  const [issueCertTypeId, setIssueCertTypeId] = useState("");
  const [issuedAt, setIssuedAt] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [issueCertNumber, setIssueCertNumber] = useState("");
  const [issueCertNotes, setIssueCertNotes] = useState("");
  const [isIssuingCert, setIsIssuingCert] = useState(false);
  const [issueCertError, setIssueCertError] = useState<string | null>(null);

  // ── Orders tab state ────────────────────────────────────────────────────────
  const [trackingEditId, setTrackingEditId] = useState<string | null>(null);
  const [trackingValue, setTrackingValue] = useState("");
  const [isSavingTracking, setIsSavingTracking] = useState(false);

  // ── Payments tab state ──────────────────────────────────────────────────────
  const [showLogPaymentPanel, setShowLogPaymentPanel] = useState(false);
  const [logPaymentType, setLogPaymentType] = useState("cash");
  const [logAmount, setLogAmount] = useState("");
  const [logBookingId, setLogBookingId] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [isLoggingPayment, setIsLoggingPayment] = useState(false);
  const [logPaymentError, setLogPaymentError] = useState<string | null>(null);

  // ── Notes tab state ─────────────────────────────────────────────────────────
  const [notesValue, setNotesValue] = useState(
    initialProfile.customer_notes ?? ""
  );
  const [notesSaving, setNotesSaving] = useState(false);

  // ── Archive account (super admin only) ──────────────────────────────────────

  const firstPanelInputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  /**
   * Archives the customer account. Only callable by super admin.
   */
  async function handleArchive() {
    setIsArchiving(true);
    try {
      const res = await fetch(`/api/customers/${initialProfile.id}/archive`, {
        method: "POST",
      });
      if (!res.ok) return;
      setShowArchiveConfirm(false);
      router.refresh();
    } finally {
      setIsArchiving(false);
    }
  }

  // ── Profile field save on blur ───────────────────────────────────────────────

  /**
   * Saves a single profile field when the user leaves the input (blur).
   * @param field - The profile field name to update.
   * @param value - The new value (empty string is stored as null for optional fields).
   */
  async function handleFieldBlur(field: string, value: string) {
    const original =
      profileValues[field as keyof typeof profileValues] ?? "";
    if (value === original) return; // No change — skip the request

    setFieldSaving(field);
    try {
      await fetch(`/api/customers/${initialProfile.id}/update-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value }),
      });
      router.refresh();
    } finally {
      setFieldSaving(null);
    }
  }

  // ── Send password reset email ────────────────────────────────────────────────

  /**
   * Triggers a password recovery email to the customer.
   */
  async function handleSendPasswordReset() {
    setPasswordResetSending(true);
    setPasswordResetMsg(null);
    try {
      const res = await fetch(
        `/api/customers/${initialProfile.id}/send-password-reset`,
        { method: "POST" }
      );
      const json = await res.json();
      if (json.success) {
        setPasswordResetMsg(`Password reset email sent to ${json.email}.`);
      } else {
        setPasswordResetMsg("Failed to send reset email. Please try again.");
      }
    } finally {
      setPasswordResetSending(false);
    }
  }

  // ── Cancel booking ───────────────────────────────────────────────────────────

  /**
   * Cancels the booking identified by cancelConfirmId with the given reason.
   */
  async function handleCancelBooking() {
    if (!cancelConfirmId || !cancelReason.trim()) return;
    setIsCancelling(true);
    try {
      await fetch(`/api/customers/${initialProfile.id}/cancel-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: cancelConfirmId,
          reason: cancelReason,
        }),
      });
      setCancelConfirmId(null);
      setCancelReason("");
      router.refresh();
    } finally {
      setIsCancelling(false);
    }
  }

  // ── Add manual booking ───────────────────────────────────────────────────────

  /**
   * Creates a manual booking for the customer in the selected session.
   */
  async function handleAddBooking(e: React.FormEvent) {
    e.preventDefault();
    setAddBookingError(null);
    if (!addSessionId || !addBookingReason.trim()) return;
    setIsAddingBooking(true);
    try {
      const res = await fetch(
        `/api/customers/${initialProfile.id}/add-booking`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: addSessionId,
            reason: addBookingReason,
          }),
        }
      );
      const json = await res.json();
      if (!json.success) {
        setAddBookingError(json.error ?? "Failed to add booking.");
        return;
      }
      setShowAddBookingPanel(false);
      setAddSessionId("");
      setAddBookingReason("");
      router.refresh();
    } finally {
      setIsAddingBooking(false);
    }
  }

  // ── Issue cert ───────────────────────────────────────────────────────────────

  /**
   * Issues a certification manually for the customer.
   */
  async function handleIssueCert(e: React.FormEvent) {
    e.preventDefault();
    setIssueCertError(null);
    if (!issueCertTypeId || !issuedAt) return;
    setIsIssuingCert(true);
    try {
      const res = await fetch(
        `/api/customers/${initialProfile.id}/issue-cert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            certTypeId: issueCertTypeId,
            issuedAt,
            certNumber: issueCertNumber,
            notes: issueCertNotes,
          }),
        }
      );
      const json = await res.json();
      if (!json.success) {
        setIssueCertError(json.error ?? "Failed to issue cert.");
        return;
      }
      setShowIssueCertPanel(false);
      setIssueCertTypeId("");
      setIssuedAt(new Date().toISOString().split("T")[0]);
      setIssueCertNumber("");
      setIssueCertNotes("");
      router.refresh();
    } finally {
      setIsIssuingCert(false);
    }
  }

  // ── Update tracking ──────────────────────────────────────────────────────────

  /**
   * Saves the tracking number for an order.
   * @param orderId - The order ID to update.
   */
  async function handleSaveTracking(orderId: string) {
    setIsSavingTracking(true);
    try {
      await fetch(`/api/customers/${initialProfile.id}/update-tracking`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, trackingNumber: trackingValue }),
      });
      setTrackingEditId(null);
      setTrackingValue("");
      router.refresh();
    } finally {
      setIsSavingTracking(false);
    }
  }

  // ── Log payment ──────────────────────────────────────────────────────────────

  /**
   * Logs a manual payment (cash, check, or deposit) for the customer.
   */
  async function handleLogPayment(e: React.FormEvent) {
    e.preventDefault();
    setLogPaymentError(null);
    const parsedAmount = parseFloat(logAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setLogPaymentError("Enter a valid amount.");
      return;
    }
    setIsLoggingPayment(true);
    try {
      const res = await fetch(
        `/api/customers/${initialProfile.id}/log-payment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentType: logPaymentType,
            amount: parsedAmount,
            bookingId: logBookingId || undefined,
            notes: logNotes,
          }),
        }
      );
      const json = await res.json();
      if (!json.success) {
        setLogPaymentError(json.error ?? "Failed to log payment.");
        return;
      }
      setShowLogPaymentPanel(false);
      setLogPaymentType("cash");
      setLogAmount("");
      setLogBookingId("");
      setLogNotes("");
      router.refresh();
    } finally {
      setIsLoggingPayment(false);
    }
  }

  // ── Notes auto-save on blur ──────────────────────────────────────────────────

  /**
   * Saves staff notes when the textarea loses focus.
   */
  async function handleNotesBlur() {
    if (notesValue === (initialProfile.customer_notes ?? "")) return;
    setNotesSaving(true);
    try {
      await fetch(`/api/customers/${initialProfile.id}/update-notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesValue }),
      });
      router.refresh();
    } finally {
      setNotesSaving(false);
    }
  }

  // ── Grouped bookings ─────────────────────────────────────────────────────────
  const now = new Date();
  const upcomingBookings = bookings.filter(
    (b) => !b.cancelled && new Date(b.class_sessions.starts_at) >= now
  );
  const pastBookings = bookings.filter(
    (b) => !b.cancelled && new Date(b.class_sessions.starts_at) < now
  );
  const cancelledBookings = bookings.filter((b) => b.cancelled);

  // Bookings that have a session (not cancelled) for the log-payment panel dropdown
  const activeBookingsForPayment = bookings.filter((b) => !b.cancelled);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Shared panel field class for consistent styling. */
  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500";

  /** Shared label class. */
  const labelClass = "mb-1 block text-sm font-medium text-gray-700";

  // ── Editable profile field ───────────────────────────────────────────────────

  /**
   * Renders a labeled inline-editable text input for a profile field.
   * Saves on blur if the value changed.
   */
  function EditableField({
    field,
    label,
    type = "text",
    note,
  }: {
    field: keyof typeof profileValues;
    label: string;
    type?: string;
    note?: string;
  }) {
    return (
      <div>
        <label htmlFor={field} className={labelClass}>
          {label}
          {fieldSaving === field && (
            <span className="ml-2 text-xs text-gray-400">Saving…</span>
          )}
        </label>
        <input
          id={field}
          type={type}
          value={profileValues[field]}
          onChange={(e) =>
            setProfileValues((prev) => ({ ...prev, [field]: e.target.value }))
          }
          onBlur={(e) => handleFieldBlur(field, e.target.value)}
          className={inputClass}
        />
        {note && <p className="mt-1 text-xs text-amber-600">{note}</p>}
      </div>
    );
  }

  // ── Slide-in panel wrapper ───────────────────────────────────────────────────

  /**
   * Wraps content in a slide-in panel overlay with a backdrop and close button.
   */
  function SlidePanel({
    title,
    onClose,
    children,
  }: {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
  }) {
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close panel"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
            {children}
          </div>
        </div>
      </>
    );
  }

  // ── Tab content renderers ─────────────────────────────────────────────────────

  /** Renders the Bookings tab — upcoming, past, and cancelled sections. */
  function renderBookingsTab() {
    return (
      <div role="tabpanel" id="tab-bookings" aria-labelledby="tab-btn-bookings">
        {/* Add Booking button */}
        {canAct && (
          <div className="mb-4 flex justify-end">
            <button
              onClick={() => setShowAddBookingPanel(true)}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              + Add Booking
            </button>
          </div>
        )}

        {/* Upcoming bookings */}
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Upcoming ({upcomingBookings.length})
        </h3>
        {upcomingBookings.length === 0 ? (
          <p className="mb-6 text-sm text-gray-400">No upcoming bookings.</p>
        ) : (
          <ul className="mb-6 space-y-3">
            {upcomingBookings.map((b) => {
              const payment = b.payments[0] ?? null;
              return (
                <li
                  key={b.id}
                  className="rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900">
                        {b.class_sessions.class_types.name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {fmtDate(b.class_sessions.starts_at)} ·{" "}
                        {fmtTime(b.class_sessions.starts_at)}–
                        {fmtTime(b.class_sessions.ends_at)}
                      </p>
                      <p className="text-sm text-gray-500">
                        {b.class_sessions.locations.name},{" "}
                        {b.class_sessions.locations.city}
                      </p>
                      <p className="text-sm text-gray-500">
                        Instructor: {b.class_sessions.profiles.first_name}{" "}
                        {b.class_sessions.profiles.last_name}
                      </p>
                      {b.grade !== null && (
                        <p className="mt-1 text-sm font-medium text-gray-700">
                          Grade: {b.grade}
                        </p>
                      )}
                      {b.booking_source === "manual" &&
                        b.manual_booking_reason && (
                          <p className="mt-1 text-xs text-amber-700">
                            Added manually: {b.manual_booking_reason}
                          </p>
                        )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold capitalize text-gray-600">
                        {b.booking_source}
                      </span>
                      {payment && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${paymentTypeClass(payment.payment_type)}`}
                        >
                          {payment.payment_type}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Cancel booking */}
                  {canAct && cancelConfirmId !== b.id && (
                    <button
                      onClick={() => setCancelConfirmId(b.id)}
                      className="mt-3 text-xs text-red-600 hover:underline"
                    >
                      Cancel booking
                    </button>
                  )}
                  {cancelConfirmId === b.id && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
                      <p className="mb-2 text-sm font-medium text-red-800">
                        Cancel this booking?
                      </p>
                      <textarea
                        placeholder="Reason (required)"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        rows={2}
                        className="mb-2 w-full rounded border border-red-300 px-2 py-1.5 text-sm focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setCancelConfirmId(null);
                            setCancelReason("");
                          }}
                          className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCancelBooking}
                          disabled={!cancelReason.trim() || isCancelling}
                          className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {isCancelling ? "Cancelling…" : "Confirm Cancellation"}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Past bookings */}
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Past ({pastBookings.length})
        </h3>
        {pastBookings.length === 0 ? (
          <p className="mb-6 text-sm text-gray-400">No past bookings.</p>
        ) : (
          <ul className="mb-6 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {pastBookings.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {b.class_sessions.class_types.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {fmtDate(b.class_sessions.starts_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {b.grade !== null && (
                    <span className="text-sm font-semibold text-gray-700">
                      Grade: {b.grade}
                    </span>
                  )}
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold capitalize text-gray-600">
                    {b.booking_source}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Cancelled bookings — collapsible */}
        {cancelledBookings.length > 0 && (
          <div>
            <button
              onClick={() => setCancelledOpen(!cancelledOpen)}
              className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700"
              aria-expanded={cancelledOpen}
            >
              {cancelledOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              Cancelled ({cancelledBookings.length})
            </button>
            {cancelledOpen && (
              <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {cancelledBookings.map((b) => (
                  <li key={b.id} className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-500 line-through">
                      {b.class_sessions.class_types.name} ·{" "}
                      {fmtDate(b.class_sessions.starts_at)}
                    </p>
                    {b.cancellation_note && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        Reason: {b.cancellation_note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }

  /** Renders the Certifications tab. */
  function renderCertificationsTab() {
    return (
      <div
        role="tabpanel"
        id="tab-certifications"
        aria-labelledby="tab-btn-certifications"
      >
        {canAct && (
          <div className="mb-4 flex justify-end">
            <button
              onClick={() => setShowIssueCertPanel(true)}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              + Issue Cert
            </button>
          </div>
        )}

        {certifications.length === 0 ? (
          <p className="text-sm text-gray-400">No certifications on record.</p>
        ) : (
          <ul className="space-y-3">
            {certifications.map((cert) => {
              const days = daysUntilExpiry(cert.expires_at);
              return (
                <li
                  key={cert.id}
                  className="rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900">
                        {cert.cert_types.name}
                      </p>
                      {cert.cert_types.issuing_body && (
                        <p className="text-xs text-gray-400">
                          {cert.cert_types.issuing_body}
                        </p>
                      )}
                      <p className="mt-1 text-sm text-gray-500">
                        Issued: {fmtDate(cert.issued_at)} · Expires:{" "}
                        {fmtDate(cert.expires_at)}
                      </p>
                      {cert.cert_number && (
                        <p className="text-xs text-gray-400">
                          Cert #{cert.cert_number}
                        </p>
                      )}
                      {cert.notes && (
                        <p className="mt-1 text-xs text-amber-700">
                          Note: {cert.notes}
                        </p>
                      )}
                      {cert.class_sessions && (
                        <p className="text-xs text-gray-400">
                          From:{" "}
                          {cert.class_sessions.class_types.name} ·{" "}
                          {fmtDate(cert.class_sessions.starts_at)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${certBadgeClass(days)}`}
                      >
                        {certBadgeLabel(days)}
                      </span>
                      {days > 0 && (
                        <Link
                          href="/classes"
                          className="text-xs text-red-600 hover:underline"
                        >
                          Book Renewal
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  /** Renders the Orders tab. */
  function renderOrdersTab() {
    return (
      <div role="tabpanel" id="tab-orders" aria-labelledby="tab-btn-orders">
        {orders.length === 0 ? (
          <p className="text-sm text-gray-400">No orders on record.</p>
        ) : (
          <ul className="space-y-4">
            {orders.map((order) => (
              <li
                key={order.id}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm text-gray-500">
                      {fmtDate(order.created_at)}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {order.order_items.map((item, i) => (
                        <li key={i} className="text-sm text-gray-800">
                          {item.product_variants.products.name} —{" "}
                          {item.product_variants.size} × {item.quantity}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-sm font-semibold text-gray-900">
                      ${order.total_amount.toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Ship to: {order.shipping_name}, {order.shipping_address},{" "}
                      {order.shipping_city}, {order.shipping_state}{" "}
                      {order.shipping_zip}
                    </p>
                    {order.tracking_number &&
                      trackingEditId !== order.id && (
                        <p className="mt-1 text-xs text-gray-500">
                          Tracking:{" "}
                          <span className="font-mono">
                            {order.tracking_number}
                          </span>
                        </p>
                      )}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${orderStatusClass(order.status)}`}
                  >
                    {order.status}
                  </span>
                </div>

                {/* Update tracking */}
                {canAct && trackingEditId !== order.id && (
                  <button
                    onClick={() => {
                      setTrackingEditId(order.id);
                      setTrackingValue(order.tracking_number ?? "");
                    }}
                    className="mt-3 text-xs text-red-600 hover:underline"
                  >
                    {order.tracking_number
                      ? "Update Tracking"
                      : "Add Tracking"}
                  </button>
                )}
                {trackingEditId === order.id && (
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      value={trackingValue}
                      onChange={(e) => setTrackingValue(e.target.value)}
                      placeholder="Tracking number"
                      className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none"
                    />
                    <button
                      onClick={() => handleSaveTracking(order.id)}
                      disabled={isSavingTracking}
                      className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {isSavingTracking ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setTrackingEditId(null)}
                      className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  /** Renders the Payments tab. */
  function renderPaymentsTab() {
    return (
      <div role="tabpanel" id="tab-payments" aria-labelledby="tab-btn-payments">
        {canAct && (
          <div className="mb-4 flex justify-end">
            <button
              onClick={() => setShowLogPaymentPanel(true)}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              + Log Payment
            </button>
          </div>
        )}

        {payments.length === 0 ? (
          <p className="text-sm text-gray-400">No payments on record.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {payments.map((pmt) => (
              <li key={pmt.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      ${pmt.amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-400">
                      {fmtDate(pmt.created_at)}
                    </p>
                    {pmt.bookings?.class_sessions && (
                      <p className="text-xs text-gray-500">
                        For:{" "}
                        {pmt.bookings.class_sessions.class_types.name} ·{" "}
                        {fmtDate(pmt.bookings.class_sessions.starts_at)}
                      </p>
                    )}
                    {pmt.paypal_transaction_id && (
                      <p className="text-xs text-gray-400">
                        PayPal: {pmt.paypal_transaction_id}
                      </p>
                    )}
                    {pmt.notes && (
                      <p className="text-xs text-gray-500">{pmt.notes}</p>
                    )}
                    {pmt.logged_by && (
                      <p className="text-xs text-gray-400">Logged manually</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${paymentTypeClass(pmt.payment_type)}`}
                    >
                      {pmt.payment_type}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pmt.status === "completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}
                    >
                      {pmt.status}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  /** Renders the Notes tab — staff-only internal notes with auto-save on blur. */
  function renderNotesTab() {
    return (
      <div role="tabpanel" id="tab-notes" aria-labelledby="tab-btn-notes">
        <p className="mb-3 text-xs text-gray-400">
          These notes are internal and not visible to the customer.
        </p>
        <textarea
          rows={10}
          value={notesValue}
          onChange={(e) => setNotesValue(e.target.value)}
          onBlur={handleNotesBlur}
          placeholder="Add internal staff notes here…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
        {notesSaving && (
          <p className="mt-1 text-xs text-gray-400">Saving…</p>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const tabList: { id: Tab; label: string }[] = [
    { id: "bookings", label: "Bookings" },
    { id: "certifications", label: "Certifications" },
    { id: "orders", label: "Orders" },
    { id: "payments", label: "Payments" },
    { id: "notes", label: "Notes" },
  ];

  return (
    <div>
      {/* ── Breadcrumb ───────────────────────────────────────────────────────── */}
      <nav className="mb-4 text-sm text-gray-500">
        <Link href="/admin/customers" className="hover:text-gray-700">
          Customers
        </Link>{" "}
        / {initialProfile.first_name} {initialProfile.last_name}
      </nav>

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {initialProfile.first_name} {initialProfile.last_name}
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">{initialProfile.email}</p>
          {initialProfile.phone && (
            <p className="text-sm text-gray-500">{initialProfile.phone}</p>
          )}
          <p className="mt-1 text-xs text-gray-400">
            Customer since {fmtDate(initialProfile.created_at)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {initialProfile.archived ? (
              <>
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                  Archived
                </span>
                {initialProfile.archived_at && (
                  <span className="text-xs text-gray-400">
                    Archived on {fmtDate(initialProfile.archived_at)}
                  </span>
                )}
              </>
            ) : (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                Active
              </span>
            )}
          </div>
        </div>

        {/* Archive button — super admin only, only if not already archived */}
        {isSuperAdmin && !initialProfile.archived && !showArchiveConfirm && (
          <button
            onClick={() => setShowArchiveConfirm(true)}
            className="flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            <AlertTriangle className="h-4 w-4" />
            Archive Account
          </button>
        )}
      </div>

      {/* Archive confirmation */}
      {showArchiveConfirm && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="mb-3 text-sm font-medium text-red-800">
            Archive this account? The customer will lose access but all data
            will be preserved.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowArchiveConfirm(false)}
              className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleArchive}
              disabled={isArchiving}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isArchiving ? "Archiving…" : "Archive Account"}
            </button>
          </div>
        </div>
      )}

      {/* ── Editable profile fields ─────────────────────────────────────────── */}
      <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Profile
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <EditableField field="first_name" label="First name" />
          <EditableField field="last_name" label="Last name" />
          <EditableField
            field="email"
            label="Email"
            type="email"
            note="Supabase will send a confirmation to the new email address"
          />
          <EditableField field="phone" label="Phone" />
          <div className="sm:col-span-2">
            <EditableField field="address" label="Address" />
          </div>
          <EditableField field="city" label="City" />
          <EditableField field="state" label="State" />
          <EditableField field="zip" label="ZIP" />
        </div>

        {/* Send password reset */}
        <div className="mt-6 border-t border-gray-100 pt-4">
          <button
            onClick={handleSendPasswordReset}
            disabled={passwordResetSending}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {passwordResetSending
              ? "Sending…"
              : "Send Password Reset Email"}
          </button>
          {passwordResetMsg && (
            <p className="mt-2 flex items-center gap-1 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              {passwordResetMsg}
            </p>
          )}
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Customer sections"
        className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200"
      >
        {tabList.map(({ id, label }) => (
          <button
            key={id}
            id={`tab-btn-${id}`}
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`tab-${id}`}
            onClick={() => setActiveTab(id)}
            className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === id
                ? "border-red-600 text-red-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === "bookings" && renderBookingsTab()}
      {activeTab === "certifications" && renderCertificationsTab()}
      {activeTab === "orders" && renderOrdersTab()}
      {activeTab === "payments" && renderPaymentsTab()}
      {activeTab === "notes" && renderNotesTab()}

      {/* ── Add Booking slide-in panel ───────────────────────────────────────── */}
      {showAddBookingPanel && (
        <SlidePanel
          title="Add Booking"
          onClose={() => {
            setShowAddBookingPanel(false);
            setAddBookingError(null);
          }}
        >
          <form onSubmit={handleAddBooking} className="flex flex-1 flex-col gap-4">
            <div>
              <label htmlFor="addSession" className={labelClass}>
                Session <span className="text-red-600">*</span>
              </label>
              <select
                id="addSession"
                required
                value={addSessionId}
                onChange={(e) => setAddSessionId(e.target.value)}
                className={inputClass}
              >
                <option value="">Select a session…</option>
                {availableSessions.map((s) => (
                  <option
                    key={s.id}
                    value={s.id}
                    disabled={s.spotsRemaining === 0}
                  >
                    {s.class_types.name} — {fmtDate(s.starts_at)}{" "}
                    {fmtTime(s.starts_at)} · {s.spotsRemaining} spot
                    {s.spotsRemaining !== 1 ? "s" : ""} left
                  </option>
                ))}
              </select>
              {availableSessions.length === 0 && (
                <p className="mt-1 text-xs text-gray-400">
                  No approved upcoming sessions available.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="addReason" className={labelClass}>
                Reason <span className="text-red-600">*</span>
              </label>
              <textarea
                id="addReason"
                required
                rows={3}
                value={addBookingReason}
                onChange={(e) => setAddBookingReason(e.target.value)}
                placeholder="Why is this booking being added manually?"
                className={inputClass}
              />
            </div>

            {addBookingError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {addBookingError}
              </p>
            )}

            <div className="mt-auto">
              <button
                type="submit"
                disabled={isAddingBooking}
                className="w-full rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isAddingBooking ? "Adding…" : "Add Booking"}
              </button>
            </div>
          </form>
        </SlidePanel>
      )}

      {/* ── Issue Cert slide-in panel ────────────────────────────────────────── */}
      {showIssueCertPanel && (
        <SlidePanel
          title="Issue Certification"
          onClose={() => {
            setShowIssueCertPanel(false);
            setIssueCertError(null);
          }}
        >
          <form onSubmit={handleIssueCert} className="flex flex-1 flex-col gap-4">
            <div>
              <label htmlFor="certType" className={labelClass}>
                Cert type <span className="text-red-600">*</span>
              </label>
              <select
                id="certType"
                required
                value={issueCertTypeId}
                onChange={(e) => setIssueCertTypeId(e.target.value)}
                className={inputClass}
              >
                <option value="">Select a cert type…</option>
                {certTypes.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name} ({ct.validity_months} months)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="issuedAt" className={labelClass}>
                Issue date <span className="text-red-600">*</span>
              </label>
              <input
                id="issuedAt"
                type="date"
                required
                value={issuedAt}
                onChange={(e) => setIssuedAt(e.target.value)}
                className={inputClass}
              />
              {issueCertTypeId && issuedAt && (
                <p className="mt-1 text-xs text-gray-400">
                  Expires:{" "}
                  {(() => {
                    const ct = certTypes.find((t) => t.id === issueCertTypeId);
                    if (!ct) return "—";
                    const exp = new Date(issuedAt);
                    exp.setMonth(exp.getMonth() + ct.validity_months);
                    return fmtDate(exp.toISOString());
                  })()}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="certNumber" className={labelClass}>
                Cert number{" "}
                <span className="text-xs text-gray-400">(optional)</span>
              </label>
              <input
                id="certNumber"
                type="text"
                value={issueCertNumber}
                onChange={(e) => setIssueCertNumber(e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="certNotes" className={labelClass}>
                Notes{" "}
                <span className="text-xs text-gray-400">(optional)</span>
              </label>
              <textarea
                id="certNotes"
                rows={2}
                value={issueCertNotes}
                onChange={(e) => setIssueCertNotes(e.target.value)}
                className={inputClass}
              />
            </div>

            {issueCertError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {issueCertError}
              </p>
            )}

            <div className="mt-auto">
              <button
                type="submit"
                disabled={isIssuingCert}
                className="w-full rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isIssuingCert ? "Issuing…" : "Issue Certification"}
              </button>
            </div>
          </form>
        </SlidePanel>
      )}

      {/* ── Log Payment slide-in panel ───────────────────────────────────────── */}
      {showLogPaymentPanel && (
        <SlidePanel
          title="Log Payment"
          onClose={() => {
            setShowLogPaymentPanel(false);
            setLogPaymentError(null);
          }}
        >
          <form onSubmit={handleLogPayment} className="flex flex-1 flex-col gap-4">
            <div>
              <label htmlFor="paymentType" className={labelClass}>
                Payment type <span className="text-red-600">*</span>
              </label>
              <select
                id="paymentType"
                required
                value={logPaymentType}
                onChange={(e) => setLogPaymentType(e.target.value)}
                className={inputClass}
              >
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="deposit">Deposit</option>
              </select>
            </div>

            <div>
              <label htmlFor="logAmount" className={labelClass}>
                Amount ($) <span className="text-red-600">*</span>
              </label>
              <input
                id="logAmount"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={logAmount}
                onChange={(e) => setLogAmount(e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="logBooking" className={labelClass}>
                Link to booking{" "}
                <span className="text-xs text-gray-400">(optional)</span>
              </label>
              <select
                id="logBooking"
                value={logBookingId}
                onChange={(e) => setLogBookingId(e.target.value)}
                className={inputClass}
              >
                <option value="">No booking linked</option>
                {activeBookingsForPayment.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.class_sessions.class_types.name} ·{" "}
                    {fmtDate(b.class_sessions.starts_at)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="logNotes" className={labelClass}>
                Notes{" "}
                <span className="text-xs text-gray-400">(optional)</span>
              </label>
              <textarea
                id="logNotes"
                rows={2}
                value={logNotes}
                onChange={(e) => setLogNotes(e.target.value)}
                className={inputClass}
              />
            </div>

            {logPaymentError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {logPaymentError}
              </p>
            )}

            <div className="mt-auto">
              <button
                type="submit"
                disabled={isLoggingPayment}
                className="w-full rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isLoggingPayment ? "Logging…" : "Log Payment"}
              </button>
            </div>
          </form>
        </SlidePanel>
      )}
    </div>
  );
}
