"use client";

/**
 * CertificationsClient — admin certifications management page component.
 * Two tabs: Certifications (list, filter, issue, edit, delete, reminders) and
 * Cert Types (add, edit, deactivate/activate).
 * Used by: app/(admin)/admin/certifications/page.tsx
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Award,
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  Plus,
  Search,
  X,
} from "lucide-react";
import { getCertStatus } from "@/lib/cert-utils";
import type { CertificationAdminRecord, CertTypeAdminRow } from "@/types/certifications";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CertificationsClientProps {
  initialCerts: CertificationAdminRecord[];
  initialCertTypes: CertTypeAdminRow[];
  remindersPaused: boolean;
}

type ActiveTab = "certifications" | "cert_types";
type StatusFilter = "all" | "active" | "expiring" | "expired";
type ReminderFilter = "all" | "sent" | "not_sent";
type ReminderBannerState = "idle" | "loading" | "sent" | "all_sent";

/** Form state used for both add and edit cert panels. */
interface CertFormState {
  customerId: string;
  customerSearch: string;
  certTypeId: string;
  issuedAt: string;
  expiresAt: string;
  certNumber: string;
  notes: string;
  reminderSent: boolean;
}

/** Minimal customer shape returned by /api/customers/search. */
interface CustomerSearchResult {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/** Form state for add/edit cert type. */
interface CertTypeFormState {
  name: string;
  description: string;
  validityMonths: string;
  issuingBody: string;
  active: boolean;
}

// ── Helper functions ───────────────────────────────────────────────────────────

/**
 * Returns today's date as a yyyy-MM-dd string for date input defaults.
 */
function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Computes the expiry date string (yyyy-MM-dd) given an issue date and validity in months.
 * @param issuedAt - Issue date as yyyy-MM-dd string
 * @param validityMonths - Number of months the cert is valid
 */
function computeExpiry(issuedAt: string, validityMonths: number): string {
  if (!issuedAt || !validityMonths) return "";
  const d = new Date(issuedAt);
  d.setMonth(d.getMonth() + validityMonths);
  return d.toISOString().split("T")[0];
}

/**
 * Formats a date string for display (e.g. "Apr 21, 2026").
 * @param dateStr - ISO date string or yyyy-MM-dd
 */
function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Returns true if a cert's expiry falls within 90 days from now (and is not expired).
 * @param expiresAt - ISO date string
 */
function isExpiringSoon(expiresAt: string): boolean {
  const now = new Date();
  const days = Math.ceil(
    (new Date(expiresAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  return days >= 0 && days <= 90;
}

/** Returns blank add-cert form state. */
function blankCertForm(): CertFormState {
  return {
    customerId: "",
    customerSearch: "",
    certTypeId: "",
    issuedAt: todayString(),
    expiresAt: "",
    certNumber: "",
    notes: "",
    reminderSent: false,
  };
}

/** Returns blank cert type form state. */
function blankCertTypeForm(): CertTypeFormState {
  return {
    name: "",
    description: "",
    validityMonths: "",
    issuingBody: "",
    active: true,
  };
}

/**
 * Validates the cert add/edit form. Returns a map of field → error message.
 * @param form - The current form state
 * @param isEdit - Whether this is an edit (skips customer validation)
 */
function validateCertForm(
  form: CertFormState,
  isEdit: boolean
): Partial<Record<keyof CertFormState, string>> {
  const errors: Partial<Record<keyof CertFormState, string>> = {};
  if (!isEdit && !form.customerId) errors.customerId = "Please select a customer.";
  if (!form.certTypeId) errors.certTypeId = "Cert type is required.";
  if (!form.issuedAt) errors.issuedAt = "Issue date is required.";
  if (!form.expiresAt) errors.expiresAt = "Expiry date is required.";
  return errors;
}

/**
 * Validates the cert type form. Returns a map of field → error message.
 * @param form - The current cert type form state
 */
function validateCertTypeForm(
  form: CertTypeFormState
): Partial<Record<keyof CertTypeFormState, string>> {
  const errors: Partial<Record<keyof CertTypeFormState, string>> = {};
  if (!form.name.trim()) errors.name = "Name is required.";
  const months = parseInt(form.validityMonths, 10);
  if (!form.validityMonths || isNaN(months) || months < 1) {
    errors.validityMonths = "Validity must be a positive number of months.";
  }
  return errors;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/**
 * Renders the expiry status badge for a certification.
 * Uses the shared getCertStatus utility for consistent label + color logic.
 * @param expiresAt - ISO date string of the cert expiry
 */
function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const { label, color } = getCertStatus(expiresAt);
  const cls =
    color === "green"
      ? "bg-green-100 text-green-800"
      : color === "amber"
      ? "bg-amber-100 text-amber-800"
      : "bg-red-100 text-red-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

/**
 * Renders the "Sent" / "Not sent" reminder badge.
 * @param sent - Whether the reminder has been sent
 */
function ReminderBadge({ sent }: { sent: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        sent ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
      }`}
    >
      {sent ? "Sent" : "Not sent"}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

/**
 * Main client component for admin certifications management.
 * @param initialCerts - All certifications fetched server-side, sorted by expiry asc
 * @param initialCertTypes - All cert types with computed issue counts
 * @param remindersPaused - Whether automated cert reminders are currently paused
 */
export default function CertificationsClient({
  initialCerts,
  initialCertTypes,
  remindersPaused: initialRemindersPaused,
}: CertificationsClientProps) {

  // ── Core state ─────────────────────────────────────────────────────────────
  const [certs, setCerts] = useState<CertificationAdminRecord[]>(initialCerts);
  const [certTypes, setCertTypes] = useState<CertTypeAdminRow[]>(initialCertTypes);
  const [remindersPaused, setRemindersPaused] = useState(initialRemindersPaused);
  const [activeTab, setActiveTab] = useState<ActiveTab>("certifications");

  // ── Filter state ───────────────────────────────────────────────────────────
  const [nameSearch, setNameSearch] = useState("");
  const [certTypeFilter, setCertTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reminderFilter, setReminderFilter] = useState<ReminderFilter>("all");

  // ── Pause reminders state ──────────────────────────────────────────────────
  const [pauseConfirmVisible, setPauseConfirmVisible] = useState(false);
  const [pauseLoading, setPauseLoading] = useState(false);

  // ── Reminder banner state ──────────────────────────────────────────────────
  const [reminderBannerState, setReminderBannerState] =
    useState<ReminderBannerState>("idle");
  const [reminderSentCount, setReminderSentCount] = useState(0);

  // ── Add cert panel state ───────────────────────────────────────────────────
  const [showAddCertPanel, setShowAddCertPanel] = useState(false);
  const [certForm, setCertForm] = useState<CertFormState>(blankCertForm());
  const [certFormErrors, setCertFormErrors] = useState<
    Partial<Record<keyof CertFormState, string>>
  >({});
  const [certFormLoading, setCertFormLoading] = useState(false);
  const [certFormError, setCertFormError] = useState<string | null>(null);

  // Customer search within add cert panel
  const [customerResults, setCustomerResults] = useState<CustomerSearchResult[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // ── Edit cert panel state ──────────────────────────────────────────────────
  const [editingCert, setEditingCert] = useState<CertificationAdminRecord | null>(null);
  const [editCertForm, setEditCertForm] = useState<CertFormState>(blankCertForm());
  const [editCertFormErrors, setEditCertFormErrors] = useState<
    Partial<Record<keyof CertFormState, string>>
  >({});
  const [editCertFormLoading, setEditCertFormLoading] = useState(false);
  const [editCertFormError, setEditCertFormError] = useState<string | null>(null);

  // ── Delete cert state ──────────────────────────────────────────────────────
  const [deletingCertId, setDeletingCertId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Add cert type panel state ──────────────────────────────────────────────
  const [showAddCertTypePanel, setShowAddCertTypePanel] = useState(false);
  const [certTypeForm, setCertTypeForm] = useState<CertTypeFormState>(
    blankCertTypeForm()
  );
  const [certTypeFormErrors, setCertTypeFormErrors] = useState<
    Partial<Record<keyof CertTypeFormState, string>>
  >({});
  const [certTypeFormLoading, setCertTypeFormLoading] = useState(false);
  const [certTypeFormError, setCertTypeFormError] = useState<string | null>(null);

  // ── Edit cert type panel state ─────────────────────────────────────────────
  const [editingCertType, setEditingCertType] = useState<CertTypeAdminRow | null>(null);
  const [editCertTypeForm, setEditCertTypeForm] = useState<CertTypeFormState>(
    blankCertTypeForm()
  );
  const [editCertTypeFormErrors, setEditCertTypeFormErrors] = useState<
    Partial<Record<keyof CertTypeFormState, string>>
  >({});
  const [editCertTypeFormLoading, setEditCertTypeFormLoading] = useState(false);
  const [editCertTypeFormError, setEditCertTypeFormError] = useState<string | null>(null);

  // ── Deactivate cert type state ─────────────────────────────────────────────
  const [togglingCertTypeId, setTogglingCertTypeId] = useState<string | null>(null);

  // ── Derived values ─────────────────────────────────────────────────────────

  /** All certs expiring within 90 days (regardless of active filters). */
  const expiringSoon = useMemo(
    () => certs.filter((c) => isExpiringSoon(c.expires_at)),
    [certs]
  );

  /** How many expiring-soon certs have not yet been reminded. */
  const unremindedCount = useMemo(
    () => expiringSoon.filter((c) => !c.reminder_sent).length,
    [expiringSoon]
  );

  /** Client-side filtered cert list. */
  const filteredCerts = useMemo(() => {
    const now = new Date();
    return certs.filter((c) => {
      // Name / email search
      if (nameSearch.trim()) {
        const q = nameSearch.toLowerCase();
        const fullName =
          `${c.profiles.first_name} ${c.profiles.last_name}`.toLowerCase();
        if (!fullName.includes(q) && !c.profiles.email.toLowerCase().includes(q)) {
          return false;
        }
      }
      // Cert type filter
      if (certTypeFilter && c.cert_types.id !== certTypeFilter) return false;
      // Status filter
      if (statusFilter !== "all") {
        const days = Math.ceil(
          (new Date(c.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (statusFilter === "expired" && days >= 0) return false;
        if (statusFilter === "expiring" && (days < 0 || days > 90)) return false;
        if (statusFilter === "active" && days <= 90) return false;
      }
      // Date range (issued_at)
      if (fromDate && c.issued_at < fromDate) return false;
      if (toDate && c.issued_at > toDate) return false;
      // Reminder filter
      if (reminderFilter === "sent" && !c.reminder_sent) return false;
      if (reminderFilter === "not_sent" && c.reminder_sent) return false;
      return true;
    });
  }, [certs, nameSearch, certTypeFilter, statusFilter, fromDate, toDate, reminderFilter]);

  // ── Customer search (debounced) ────────────────────────────────────────────

  useEffect(() => {
    const q = certForm.customerSearch.trim();
    if (q.length < 2) {
      setCustomerResults([]);
      setShowCustomerDropdown(false);
      return;
    }
    setCustomerSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/customers/search?q=${encodeURIComponent(q)}`
        );
        const json = await res.json();
        // The search endpoint returns { customers: [...] }
        setCustomerResults((json.customers ?? []).slice(0, 8));
        setShowCustomerDropdown(true);
      } catch {
        setCustomerResults([]);
      } finally {
        setCustomerSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [certForm.customerSearch]);

  // ── Auto-calculate expiry when issue date or cert type changes ─────────────

  useEffect(() => {
    if (!certForm.issuedAt || !certForm.certTypeId) return;
    const ct = certTypes.find((t) => t.id === certForm.certTypeId);
    if (!ct) return;
    setCertForm((prev) => ({
      ...prev,
      expiresAt: computeExpiry(prev.issuedAt, ct.validity_months),
    }));
  }, [certForm.issuedAt, certForm.certTypeId, certTypes]);

  useEffect(() => {
    if (!editCertForm.issuedAt || !editCertForm.certTypeId) return;
    // Only auto-update if the cert type changed (the user can manually override expiry)
    const ct = certTypes.find((t) => t.id === editCertForm.certTypeId);
    if (!ct) return;
    setEditCertForm((prev) => ({
      ...prev,
      expiresAt: computeExpiry(prev.issuedAt, ct.validity_months),
    }));
  }, [editCertForm.certTypeId]); // eslint-disable-line react-hooks/exhaustive-deps
  // ^ Intentionally only reacts to certTypeId change, not issuedAt, for edit panel.
  // Users can freely adjust issued_at and expiry independently on the edit form.

  // ── Handlers ───────────────────────────────────────────────────────────────

  /**
   * Pauses automated cert reminders by updating the system_settings flag.
   */
  const handlePauseReminders = useCallback(async () => {
    setPauseLoading(true);
    try {
      const res = await fetch("/api/certifications/reminders-pause", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: true }),
      });
      if (!res.ok) throw new Error("Failed to pause reminders.");
      setRemindersPaused(true);
      setPauseConfirmVisible(false);
    } catch {
      // Non-critical — user can retry
    } finally {
      setPauseLoading(false);
    }
  }, []);

  /**
   * Resumes automated cert reminders immediately (no confirmation required).
   */
  const handleResumeReminders = useCallback(async () => {
    setPauseLoading(true);
    try {
      const res = await fetch("/api/certifications/reminders-pause", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: false }),
      });
      if (!res.ok) throw new Error("Failed to resume reminders.");
      setRemindersPaused(false);
    } catch {
      // Non-critical — user can retry
    } finally {
      setPauseLoading(false);
    }
  }, []);

  /**
   * Sends expiry reminders to all expiring-soon customers who haven't been reminded yet.
   */
  const handleSendReminders = useCallback(async () => {
    setReminderBannerState("loading");
    try {
      const res = await fetch("/api/certifications/send-reminders", {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to send reminders.");
      const count: number = json.count ?? 0;
      setReminderSentCount(count);
      setReminderBannerState(count === 0 ? "all_sent" : "sent");
      // Mark reminded certs as sent in local state
      if (count > 0) {
        setCerts((prev) =>
          prev.map((c) =>
            isExpiringSoon(c.expires_at) && !c.reminder_sent
              ? { ...c, reminder_sent: true }
              : c
          )
        );
      }
    } catch {
      setReminderBannerState("idle");
    }
  }, []);

  /**
   * Submits the add cert form to create a new manually issued certification.
   */
  const handleAddCertSubmit = useCallback(async () => {
    const errors = validateCertForm(certForm, false);
    setCertFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setCertFormLoading(true);
    setCertFormError(null);
    try {
      const res = await fetch("/api/certifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: certForm.customerId,
          certTypeId: certForm.certTypeId,
          issuedAt: certForm.issuedAt,
          expiresAt: certForm.expiresAt,
          certNumber: certForm.certNumber.trim() || null,
          notes: certForm.notes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create certification.");

      // Add the new cert to local state; re-sort by expires_at asc
      setCerts((prev) =>
        [...prev, json.cert as CertificationAdminRecord].sort(
          (a, b) =>
            new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()
        )
      );
      setShowAddCertPanel(false);
      setCertForm(blankCertForm());
    } catch (err) {
      setCertFormError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setCertFormLoading(false);
    }
  }, [certForm]);

  /**
   * Opens the edit cert panel, pre-filling form with the given cert's values.
   * @param cert - The certification record to edit
   */
  const handleOpenEditCert = useCallback((cert: CertificationAdminRecord) => {
    setEditingCert(cert);
    setEditCertForm({
      customerId: cert.profiles.id,
      customerSearch: `${cert.profiles.first_name} ${cert.profiles.last_name}`,
      certTypeId: cert.cert_types.id,
      issuedAt: cert.issued_at,
      expiresAt: cert.expires_at,
      certNumber: cert.cert_number ?? "",
      notes: cert.notes ?? "",
      reminderSent: cert.reminder_sent,
    });
    setEditCertFormErrors({});
    setEditCertFormError(null);
  }, []);

  /**
   * Submits the edit cert form to update an existing certification.
   */
  const handleEditCertSave = useCallback(async () => {
    if (!editingCert) return;
    const errors = validateCertForm(editCertForm, true);
    setEditCertFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setEditCertFormLoading(true);
    setEditCertFormError(null);
    try {
      const res = await fetch(`/api/certifications/${editingCert.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          certTypeId: editCertForm.certTypeId,
          issuedAt: editCertForm.issuedAt,
          expiresAt: editCertForm.expiresAt,
          certNumber: editCertForm.certNumber.trim() || null,
          notes: editCertForm.notes.trim() || null,
          reminderSent: editCertForm.reminderSent,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update certification.");

      const updated = json.cert as CertificationAdminRecord;
      setCerts((prev) =>
        prev
          .map((c) => (c.id === updated.id ? updated : c))
          .sort(
            (a, b) =>
              new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()
          )
      );
      setEditingCert(null);
    } catch (err) {
      setEditCertFormError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setEditCertFormLoading(false);
    }
  }, [editingCert, editCertForm]);

  /**
   * Deletes the certification currently marked for deletion after inline confirmation.
   */
  const handleDeleteCert = useCallback(async () => {
    if (!deletingCertId) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/certifications/${deletingCertId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to delete certification.");
      }
      setCerts((prev) => prev.filter((c) => c.id !== deletingCertId));
      setDeletingCertId(null);
    } catch {
      // Silently fail — the row stays visible
    } finally {
      setDeleteLoading(false);
    }
  }, [deletingCertId]);

  /**
   * Submits the add cert type form.
   */
  const handleAddCertTypeSubmit = useCallback(async () => {
    const errors = validateCertTypeForm(certTypeForm);
    setCertTypeFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setCertTypeFormLoading(true);
    setCertTypeFormError(null);
    try {
      const res = await fetch("/api/cert-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: certTypeForm.name.trim(),
          description: certTypeForm.description.trim() || null,
          validityMonths: parseInt(certTypeForm.validityMonths, 10),
          issuingBody: certTypeForm.issuingBody.trim() || null,
          active: certTypeForm.active,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create cert type.");
      const newType: CertTypeAdminRow = { ...json.certType, certCount: 0 };
      setCertTypes((prev) =>
        [...prev, newType].sort((a, b) => a.name.localeCompare(b.name))
      );
      setShowAddCertTypePanel(false);
      setCertTypeForm(blankCertTypeForm());
    } catch (err) {
      setCertTypeFormError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setCertTypeFormLoading(false);
    }
  }, [certTypeForm]);

  /**
   * Opens the edit cert type panel, pre-filling form with existing values.
   * @param ct - The cert type to edit
   */
  const handleOpenEditCertType = useCallback((ct: CertTypeAdminRow) => {
    setEditingCertType(ct);
    setEditCertTypeForm({
      name: ct.name,
      description: ct.description ?? "",
      validityMonths: String(ct.validity_months),
      issuingBody: ct.issuing_body ?? "",
      active: ct.active,
    });
    setEditCertTypeFormErrors({});
    setEditCertTypeFormError(null);
  }, []);

  /**
   * Submits the edit cert type form.
   */
  const handleEditCertTypeSave = useCallback(async () => {
    if (!editingCertType) return;
    const errors = validateCertTypeForm(editCertTypeForm);
    setEditCertTypeFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setEditCertTypeFormLoading(true);
    setEditCertTypeFormError(null);
    try {
      const res = await fetch(`/api/cert-types/${editingCertType.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editCertTypeForm.name.trim(),
          description: editCertTypeForm.description.trim() || null,
          validityMonths: parseInt(editCertTypeForm.validityMonths, 10),
          issuingBody: editCertTypeForm.issuingBody.trim() || null,
          active: editCertTypeForm.active,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update cert type.");
      setCertTypes((prev) =>
        prev
          .map((ct) =>
            ct.id === editingCertType.id
              ? { ...json.certType, certCount: ct.certCount }
              : ct
          )
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingCertType(null);
    } catch (err) {
      setEditCertTypeFormError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setEditCertTypeFormLoading(false);
    }
  }, [editingCertType, editCertTypeForm]);

  /**
   * Toggles the active state of a cert type (deactivate or reactivate).
   * @param ct - The cert type to toggle
   */
  const handleToggleCertTypeActive = useCallback(
    async (ct: CertTypeAdminRow) => {
      setTogglingCertTypeId(ct.id);
      try {
        const res = await fetch(`/api/cert-types/${ct.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: !ct.active }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to update cert type.");
        setCertTypes((prev) =>
          prev.map((t) =>
            t.id === ct.id ? { ...t, active: !ct.active } : t
          )
        );
      } catch {
        // Silently fail — badge stays unchanged
      } finally {
        setTogglingCertTypeId(null);
      }
    },
    []
  );

  // ── Active cert types (for use in add/edit cert dropdowns) ─────────────────
  const activeCertTypes = useMemo(
    () => certTypes.filter((ct) => ct.active),
    [certTypes]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Certifications</h1>

        {/* Pause / Resume reminders toggle */}
        <div className="flex items-center gap-3">
          {pauseConfirmVisible ? (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <span className="text-amber-800">Pause all automated cert expiry reminders?</span>
              <button
                onClick={() => setPauseConfirmVisible(false)}
                className="rounded px-2 py-1 text-gray-600 hover:bg-amber-100"
              >
                Cancel
              </button>
              <button
                onClick={handlePauseReminders}
                disabled={pauseLoading}
                className="rounded bg-amber-600 px-2 py-1 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {pauseLoading ? "Pausing…" : "Pause"}
              </button>
            </div>
          ) : remindersPaused ? (
            <button
              onClick={handleResumeReminders}
              disabled={pauseLoading}
              aria-pressed={true}
              aria-label="Resume cert reminders"
              className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              <BellOff className="h-4 w-4" />
              Reminders: Paused
            </button>
          ) : (
            <button
              onClick={() => setPauseConfirmVisible(true)}
              aria-pressed={false}
              aria-label="Pause cert reminders"
              className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
            >
              <Bell className="h-4 w-4" />
              Reminders: Active
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Certifications sections"
        className="mb-6 flex border-b border-gray-200"
      >
        {(["certifications", "cert_types"] as ActiveTab[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`tabpanel-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-red-600 text-red-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            {tab === "certifications" ? "Certifications" : "Cert Types"}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1 — CERTIFICATIONS
         ══════════════════════════════════════════════════════════════════════ */}
      <div
        id="tabpanel-certifications"
        role="tabpanel"
        aria-label="Certifications"
        hidden={activeTab !== "certifications"}
      >
        {/* Section header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            All Certifications
          </h2>
          <button
            onClick={() => {
              setShowAddCertPanel(true);
              setCertForm(blankCertForm());
              setCertFormErrors({});
              setCertFormError(null);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <Plus className="h-4 w-4" />
            Issue Certification
          </button>
        </div>

        {/* Expiring soon banner */}
        {expiringSoon.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {reminderBannerState === "sent" ? (
                  <p role="status" className="font-medium text-green-700">
                    Reminders sent to {reminderSentCount} customer{reminderSentCount !== 1 ? "s" : ""}.
                  </p>
                ) : reminderBannerState === "all_sent" ? (
                  <p role="status" className="font-medium text-green-700">
                    All expiring customers have already been reminded.
                  </p>
                ) : (
                  <p className="font-medium text-amber-800">
                    {expiringSoon.length} certification{expiringSoon.length !== 1 ? "s" : ""} expiring within 90 days
                    {unremindedCount > 0 && (
                      <span className="ml-1 text-amber-700">
                        ({unremindedCount} not yet reminded)
                      </span>
                    )}
                  </p>
                )}
              </div>
              {reminderBannerState !== "sent" && reminderBannerState !== "all_sent" && (
                <button
                  onClick={handleSendReminders}
                  disabled={reminderBannerState === "loading" || remindersPaused}
                  title={remindersPaused ? "Reminders are currently paused" : undefined}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {reminderBannerState === "loading" ? "Sending…" : "Send Reminders to All"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Customer name / email search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or email"
              value={nameSearch}
              onChange={(e) => setNameSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Cert type filter */}
          <select
            value={certTypeFilter}
            onChange={(e) => setCertTypeFilter(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">All cert types</option>
            {certTypes.map((ct) => (
              <option key={ct.id} value={ct.id}>
                {ct.name}
              </option>
            ))}
          </select>

          {/* Reminder filter */}
          <select
            value={reminderFilter}
            onChange={(e) =>
              setReminderFilter(e.target.value as ReminderFilter)
            }
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="all">All reminders</option>
            <option value="sent">Reminder sent</option>
            <option value="not_sent">Not sent</option>
          </select>

          {/* Date range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Status pill filters */}
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-2">
            {(["all", "active", "expiring", "expired"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-red-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {s === "all"
                  ? "All"
                  : s === "active"
                  ? "Active"
                  : s === "expiring"
                  ? "Expiring Soon"
                  : "Expired"}
              </button>
            ))}
          </div>
        </div>

        {/* Certifications table — desktop */}
        {filteredCerts.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 py-12 text-center text-sm text-gray-500">
            No certifications match the current filters.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-lg border border-gray-200 lg:block">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Cert Type</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Issued</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Cert #</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Reminder</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {filteredCerts.map((cert) => (
                    <tr
                      key={cert.id}
                      className={
                        isExpiringSoon(cert.expires_at)
                          ? "border-l-2 border-amber-400"
                          : ""
                      }
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/customers/${cert.profiles.id}`}
                          className="font-medium text-gray-900 hover:text-red-600"
                        >
                          {cert.profiles.first_name} {cert.profiles.last_name}
                        </Link>
                        <div className="text-xs text-gray-400">{cert.profiles.email}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        <div>{cert.cert_types.name}</div>
                        {cert.session_id === null && (
                          <span className="mt-0.5 inline-block rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                            Manual
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {fmtDate(cert.issued_at)}
                      </td>
                      <td className="px-4 py-3">
                        <ExpiryBadge expiresAt={cert.expires_at} />
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {cert.cert_number ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <ReminderBadge sent={cert.reminder_sent} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {deletingCertId === cert.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-gray-600">
                              Delete cert for {cert.profiles.first_name}?
                            </span>
                            <button
                              onClick={() => setDeletingCertId(null)}
                              className="text-xs text-gray-500 hover:text-gray-700"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleDeleteCert}
                              disabled={deleteLoading}
                              className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              {deleteLoading ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleOpenEditCert(cert)}
                              className="text-xs font-medium text-gray-600 hover:text-red-600"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setDeletingCertId(cert.id)}
                              className="text-xs font-medium text-red-500 hover:text-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 lg:hidden">
              {filteredCerts.map((cert) => (
                <div
                  key={cert.id}
                  className={`rounded-lg border bg-white p-4 ${
                    isExpiringSoon(cert.expires_at)
                      ? "border-l-4 border-l-amber-400 border-gray-200"
                      : "border-gray-200"
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/admin/customers/${cert.profiles.id}`}
                        className="font-medium text-gray-900 hover:text-red-600"
                      >
                        {cert.profiles.first_name} {cert.profiles.last_name}
                      </Link>
                      <div className="text-xs text-gray-400">{cert.profiles.email}</div>
                    </div>
                    <div className="flex gap-1">
                      <ExpiryBadge expiresAt={cert.expires_at} />
                    </div>
                  </div>
                  <div className="mb-2 text-sm text-gray-700">
                    {cert.cert_types.name}
                    {cert.session_id === null && (
                      <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                        Manual
                      </span>
                    )}
                  </div>
                  <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-gray-500">
                    <div>Issued: {fmtDate(cert.issued_at)}</div>
                    <div>Cert #: {cert.cert_number ?? "—"}</div>
                    <div className="col-span-2">
                      <ReminderBadge sent={cert.reminder_sent} />
                    </div>
                  </div>
                  {deletingCertId === cert.id ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-600">
                        Delete cert for {cert.profiles.first_name}?
                      </span>
                      <button
                        onClick={() => setDeletingCertId(null)}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDeleteCert}
                        disabled={deleteLoading}
                        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleteLoading ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-3 text-sm">
                      <button
                        onClick={() => handleOpenEditCert(cert)}
                        className="font-medium text-gray-600 hover:text-red-600"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeletingCertId(cert.id)}
                        className="font-medium text-red-500 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2 — CERT TYPES
         ══════════════════════════════════════════════════════════════════════ */}
      <div
        id="tabpanel-cert_types"
        role="tabpanel"
        aria-label="Cert Types"
        hidden={activeTab !== "cert_types"}
      >
        {/* Section header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Cert Types</h2>
          <button
            onClick={() => {
              setShowAddCertTypePanel(true);
              setCertTypeForm(blankCertTypeForm());
              setCertTypeFormErrors({});
              setCertTypeFormError(null);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <Plus className="h-4 w-4" />
            Add Cert Type
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {certTypes.map((ct) => (
            <div key={ct.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="font-semibold text-gray-900">{ct.name}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    ct.active
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {ct.active ? "Active" : "Inactive"}
                </span>
              </div>
              {ct.issuing_body && (
                <div className="mb-1 text-xs text-gray-500">{ct.issuing_body}</div>
              )}
              <div className="mb-1 text-xs text-gray-500">
                Valid for {ct.validity_months} months
              </div>
              <div className="mb-4 text-xs text-gray-400">
                {ct.certCount} cert{ct.certCount !== 1 ? "s" : ""} issued
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleOpenEditCertType(ct)}
                  className="text-xs font-medium text-gray-600 hover:text-red-600"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleToggleCertTypeActive(ct)}
                  disabled={togglingCertTypeId === ct.id}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50"
                >
                  {togglingCertTypeId === ct.id
                    ? "Saving…"
                    : ct.active
                    ? "Deactivate"
                    : "Activate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SLIDE-IN PANEL — ADD CERT
         ══════════════════════════════════════════════════════════════════════ */}
      {showAddCertPanel && (
        <SlidePanel
          title="Issue Certification"
          onClose={() => setShowAddCertPanel(false)}
        >
          <CertForm
            form={certForm}
            setForm={setCertForm}
            errors={certFormErrors}
            isEdit={false}
            certTypes={activeCertTypes}
            customerResults={customerResults}
            customerSearchLoading={customerSearchLoading}
            showCustomerDropdown={showCustomerDropdown}
            setShowCustomerDropdown={setShowCustomerDropdown}
            onCustomerSelect={(c) => {
              setCertForm((prev) => ({
                ...prev,
                customerId: c.id,
                customerSearch: `${c.first_name} ${c.last_name} (${c.email})`,
              }));
              setShowCustomerDropdown(false);
            }}
          />
          {certFormError && (
            <p className="mt-2 text-sm text-red-600">{certFormError}</p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setShowAddCertPanel(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAddCertSubmit}
              disabled={certFormLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {certFormLoading ? "Issuing…" : "Issue Certification"}
            </button>
          </div>
        </SlidePanel>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SLIDE-IN PANEL — EDIT CERT
         ══════════════════════════════════════════════════════════════════════ */}
      {editingCert && (
        <SlidePanel
          title="Edit Certification"
          onClose={() => setEditingCert(null)}
        >
          {/* Customer name (read-only in edit) */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Customer
            </label>
            <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {editingCert.profiles.first_name} {editingCert.profiles.last_name} — {editingCert.profiles.email}
            </p>
          </div>
          <CertForm
            form={editCertForm}
            setForm={setEditCertForm}
            errors={editCertFormErrors}
            isEdit={true}
            certTypes={certTypes}
            customerResults={[]}
            customerSearchLoading={false}
            showCustomerDropdown={false}
            setShowCustomerDropdown={() => undefined}
            onCustomerSelect={() => undefined}
          />
          {/* Reminder sent checkbox — can be manually reset */}
          <div className="mb-4 flex items-center gap-2">
            <input
              type="checkbox"
              id="edit-reminder-sent"
              checked={editCertForm.reminderSent}
              onChange={(e) =>
                setEditCertForm((prev) => ({
                  ...prev,
                  reminderSent: e.target.checked,
                }))
              }
              className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
            <label htmlFor="edit-reminder-sent" className="text-sm text-gray-700">
              Reminder sent
            </label>
            <span className="text-xs text-gray-400">(uncheck to allow re-sending)</span>
          </div>
          {editCertFormError && (
            <p className="mt-2 text-sm text-red-600">{editCertFormError}</p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setEditingCert(null)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleEditCertSave}
              disabled={editCertFormLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {editCertFormLoading ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </SlidePanel>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SLIDE-IN PANEL — ADD CERT TYPE
         ══════════════════════════════════════════════════════════════════════ */}
      {showAddCertTypePanel && (
        <SlidePanel
          title="Add Cert Type"
          onClose={() => setShowAddCertTypePanel(false)}
        >
          <CertTypeForm
            form={certTypeForm}
            setForm={setCertTypeForm}
            errors={certTypeFormErrors}
          />
          {certTypeFormError && (
            <p className="mt-2 text-sm text-red-600">{certTypeFormError}</p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setShowAddCertTypePanel(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAddCertTypeSubmit}
              disabled={certTypeFormLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {certTypeFormLoading ? "Adding…" : "Add Cert Type"}
            </button>
          </div>
        </SlidePanel>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SLIDE-IN PANEL — EDIT CERT TYPE
         ══════════════════════════════════════════════════════════════════════ */}
      {editingCertType && (
        <SlidePanel
          title="Edit Cert Type"
          onClose={() => setEditingCertType(null)}
        >
          <CertTypeForm
            form={editCertTypeForm}
            setForm={setEditCertTypeForm}
            errors={editCertTypeFormErrors}
          />
          {editCertTypeFormError && (
            <p className="mt-2 text-sm text-red-600">{editCertTypeFormError}</p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setEditingCertType(null)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleEditCertTypeSave}
              disabled={editCertTypeFormLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {editCertTypeFormLoading ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </SlidePanel>
      )}
    </div>
  );
}

// ── SlidePanel ─────────────────────────────────────────────────────────────────

/**
 * Reusable slide-in panel overlay with title and close button.
 * @param title - Panel heading text
 * @param onClose - Called when the user closes the panel
 * @param children - Panel body content
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-600"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </>
  );
}

// ── CertForm ───────────────────────────────────────────────────────────────────

interface CertFormProps {
  form: CertFormState;
  setForm: React.Dispatch<React.SetStateAction<CertFormState>>;
  errors: Partial<Record<keyof CertFormState, string>>;
  isEdit: boolean;
  certTypes: CertTypeAdminRow[];
  customerResults: CustomerSearchResult[];
  customerSearchLoading: boolean;
  showCustomerDropdown: boolean;
  setShowCustomerDropdown: (v: boolean) => void;
  onCustomerSelect: (c: CustomerSearchResult) => void;
}

/**
 * Shared form fields for both add and edit cert panels.
 * In edit mode, the customer field is hidden (customer is shown read-only outside this component).
 * @param form - Current form state
 * @param setForm - State setter for the form
 * @param errors - Validation errors keyed by field name
 * @param isEdit - True when editing an existing cert; hides customer field
 * @param certTypes - Cert types available for selection (active only for add, all for edit)
 * @param customerResults - Debounced customer search results
 * @param customerSearchLoading - Whether the customer search is in progress
 * @param showCustomerDropdown - Whether the customer dropdown is visible
 * @param setShowCustomerDropdown - Setter for dropdown visibility
 * @param onCustomerSelect - Called when a customer is selected from the dropdown
 */
function CertForm({
  form,
  setForm,
  errors,
  isEdit,
  certTypes,
  customerResults,
  customerSearchLoading,
  showCustomerDropdown,
  setShowCustomerDropdown,
  onCustomerSelect,
}: CertFormProps) {
  return (
    <div className="space-y-4">
      {/* Customer search — add mode only */}
      {!isEdit && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Customer <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or email"
              value={form.customerSearch}
              onChange={(e) => {
                setForm((prev) => ({
                  ...prev,
                  customerSearch: e.target.value,
                  // Clear selection if user modifies text
                  customerId: prev.customerId && e.target.value !== prev.customerSearch
                    ? "" : prev.customerId,
                }));
              }}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            {customerSearchLoading && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                Searching…
              </span>
            )}
          </div>
          {showCustomerDropdown && customerResults.length > 0 && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-md">
              {customerResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onCustomerSelect(c)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                >
                  <span className="font-medium text-gray-900">
                    {c.first_name} {c.last_name}
                  </span>
                  <span className="ml-2 text-gray-400">{c.email}</span>
                </button>
              ))}
            </div>
          )}
          {errors.customerId && (
            <p className="mt-1 text-xs text-red-600">{errors.customerId}</p>
          )}
        </div>
      )}

      {/* Cert type */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Cert Type <span className="text-red-500">*</span>
        </label>
        <select
          value={form.certTypeId}
          onChange={(e) => setForm((prev) => ({ ...prev, certTypeId: e.target.value }))}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="">Select a cert type</option>
          {certTypes.map((ct) => (
            <option key={ct.id} value={ct.id}>
              {ct.name} ({ct.validity_months} months)
            </option>
          ))}
        </select>
        {errors.certTypeId && (
          <p className="mt-1 text-xs text-red-600">{errors.certTypeId}</p>
        )}
      </div>

      {/* Issue date */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Issue Date <span className="text-red-500">*</span>
        </label>
        <input
          type="date"
          value={form.issuedAt}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, issuedAt: e.target.value }))
          }
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        {errors.issuedAt && (
          <p className="mt-1 text-xs text-red-600">{errors.issuedAt}</p>
        )}
      </div>

      {/* Expiry date — auto-calculated but editable */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Expiry Date <span className="text-red-500">*</span>
          <span className="ml-1 font-normal text-xs text-gray-400">
            (auto-calculated from cert type)
          </span>
        </label>
        <input
          type="date"
          value={form.expiresAt}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, expiresAt: e.target.value }))
          }
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        {errors.expiresAt && (
          <p className="mt-1 text-xs text-red-600">{errors.expiresAt}</p>
        )}
      </div>

      {/* Cert number (optional) */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Cert Number <span className="text-xs font-normal text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={form.certNumber}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, certNumber: e.target.value }))
          }
          placeholder="e.g. AHA-123456"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>

      {/* Notes (optional) */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Notes <span className="text-xs font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          value={form.notes}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, notes: e.target.value }))
          }
          rows={3}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>
    </div>
  );
}

// ── CertTypeForm ───────────────────────────────────────────────────────────────

interface CertTypeFormProps {
  form: CertTypeFormState;
  setForm: React.Dispatch<React.SetStateAction<CertTypeFormState>>;
  errors: Partial<Record<keyof CertTypeFormState, string>>;
}

/**
 * Shared form fields for add and edit cert type panels.
 * @param form - Current form state
 * @param setForm - State setter for the form
 * @param errors - Validation errors keyed by field name
 */
function CertTypeForm({ form, setForm, errors }: CertTypeFormProps) {
  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="e.g. BLS for Healthcare Providers"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        {errors.name && (
          <p className="mt-1 text-xs text-red-600">{errors.name}</p>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Description <span className="text-xs font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          value={form.description}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, description: e.target.value }))
          }
          rows={2}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>

      {/* Validity months */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Validity (months) <span className="text-red-500">*</span>
        </label>
        <input
          type="number"
          min={1}
          value={form.validityMonths}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, validityMonths: e.target.value }))
          }
          placeholder="e.g. 24"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        {errors.validityMonths && (
          <p className="mt-1 text-xs text-red-600">{errors.validityMonths}</p>
        )}
      </div>

      {/* Issuing body */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Issuing Body <span className="text-xs font-normal text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={form.issuingBody}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, issuingBody: e.target.value }))
          }
          placeholder="e.g. American Heart Association"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="cert-type-active"
          checked={form.active}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, active: e.target.checked }))
          }
          className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
        />
        <label htmlFor="cert-type-active" className="text-sm text-gray-700">
          Active
        </label>
      </div>
    </div>
  );
}
