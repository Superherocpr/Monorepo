"use client";

/**
 * PromoCodesClient — interactive promo codes management table with create/edit/delete.
 * Supports three scope modes: all sessions, specific class types, or specific sessions.
 * Used by: /admin/promo-codes (super_admin only)
 */

import { useState } from "react";
import type { PromoCodeRow } from "@/app/api/admin/promo-codes/route";
import type { SessionOption, ClassTypeOption } from "../page";

interface PromoCodesClientProps {
  initialCodes: PromoCodeRow[];
  sessions: SessionOption[];
  classTypes: ClassTypeOption[];
}

type DiscountType = "fixed" | "percent" | "free";
type PromoScope = "all" | "session_type" | "session";

interface FormState {
  code: string;
  discountType: DiscountType;
  discountValue: string;
  expiresAt: string;
  scope: PromoScope;
  sessionIds: string[];
  classTypeIds: string[];
}

const EMPTY_FORM: FormState = {
  code: "",
  discountType: "fixed",
  discountValue: "",
  expiresAt: "",
  scope: "all",
  sessionIds: [],
  classTypeIds: [],
};

/**
 * Formats a discount for display in the table.
 * @param type  - Discount type enum value
 * @param value - Numeric discount value
 */
function formatDiscount(type: DiscountType, value: number): string {
  if (type === "free") return "100% off (free)";
  if (type === "percent") return `${value}% off`;
  return `$${value.toFixed(2)} off`;
}

/**
 * Returns a human-readable scope summary for the table.
 * @param code - The promo code row
 */
function formatScope(code: PromoCodeRow): string {
  if (code.scope === "all") return "All sessions";
  if (code.scope === "session_type") {
    const n = code.class_type_ids.length;
    return `${n} class ${n === 1 ? "type" : "types"}`;
  }
  const n = code.session_ids.length;
  return `${n} ${n === 1 ? "session" : "sessions"}`;
}

/**
 * Formats an ISO expiry date for display.
 * @param expiresAt - ISO date string or null
 */
function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "Never";
  return new Date(expiresAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Renders the full promo codes management UI. */
export default function PromoCodesClient({ initialCodes, sessions, classTypes }: PromoCodesClientProps) {
  const [codes, setCodes] = useState<PromoCodeRow[]>(initialCodes);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  /** Opens the create modal with a blank form. */
  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  /**
   * Opens the edit modal pre-populated with the given code's data.
   * @param code - The promo code row to edit
   */
  function openEdit(code: PromoCodeRow) {
    setFormError(null);
    setEditingId(code.id);
    setForm({
      code: code.code,
      discountType: code.discount_type,
      discountValue: code.discount_type === "free" ? "" : String(code.discount_value),
      expiresAt: code.expires_at ? code.expires_at.slice(0, 10) : "",
      scope: code.scope,
      sessionIds: code.session_ids,
      classTypeIds: code.class_type_ids,
    });
    setModalOpen(true);
  }

  /** Submits the create or edit form. */
  async function handleSubmit(e: React.MouseEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.code.trim()) {
      setFormError("Code is required.");
      return;
    }
    if (form.discountType !== "free" && (!form.discountValue || isNaN(parseFloat(form.discountValue)))) {
      setFormError("Discount value is required.");
      return;
    }
    if (form.scope === "session" && form.sessionIds.length === 0) {
      setFormError("At least one session must be selected.");
      return;
    }
    if (form.scope === "session_type" && form.classTypeIds.length === 0) {
      setFormError("At least one class type must be selected.");
      return;
    }

    const payload = {
      code: form.code.trim().toUpperCase(),
      discount_type: form.discountType,
      discount_value: form.discountType === "free" ? 0 : parseFloat(form.discountValue),
      expires_at: form.expiresAt ? new Date(form.expiresAt + "T23:59:59").toISOString() : null,
      scope: form.scope,
      session_ids: form.scope === "session" ? form.sessionIds : [],
      class_type_ids: form.scope === "session_type" ? form.classTypeIds : [],
    };

    setSubmitting(true);

    try {
      const url = editingId ? `/api/admin/promo-codes/${editingId}` : "/api/admin/promo-codes";
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await res.json().catch(() => ({ data: null, error: "Unknown error" }))) as {
        data: { id: string } | null;
        error: string | null;
      };

      if (!res.ok || result.error) {
        setFormError(result.error ?? "Failed to save promo code.");
        return;
      }

      if (editingId) {
        setCodes((prev) =>
          prev.map((c) =>
            c.id === editingId
              ? {
                  ...c,
                  code: payload.code,
                  discount_type: payload.discount_type as DiscountType,
                  discount_value: payload.discount_value,
                  expires_at: payload.expires_at,
                  scope: payload.scope as PromoScope,
                  session_ids: payload.session_ids,
                  class_type_ids: payload.class_type_ids,
                }
              : c
          )
        );
      } else {
        const newCode: PromoCodeRow = {
          id: result.data!.id,
          code: payload.code,
          discount_type: payload.discount_type as DiscountType,
          discount_value: payload.discount_value,
          expires_at: payload.expires_at,
          active: true,
          created_at: new Date().toISOString(),
          scope: payload.scope as PromoScope,
          session_ids: payload.session_ids,
          class_type_ids: payload.class_type_ids,
        };
        setCodes((prev) => [newCode, ...prev]);
      }

      setModalOpen(false);
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Toggles the active flag without opening the edit modal.
   * @param code - The promo code row to toggle
   */
  async function handleToggleActive(code: PromoCodeRow) {
    setTogglingId(code.id);
    try {
      const res = await fetch(`/api/admin/promo-codes/${code.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !code.active }),
      });
      if (res.ok) {
        setCodes((prev) =>
          prev.map((c) => (c.id === code.id ? { ...c, active: !c.active } : c))
        );
      }
    } finally {
      setTogglingId(null);
    }
  }

  /**
   * Hard-deletes a promo code after confirmation.
   * @param id - UUID of the promo code to delete
   */
  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCodes((prev) => prev.filter((c) => c.id !== id));
        setDeleteConfirmId(null);
      }
    } finally {
      setDeleting(false);
    }
  }

  /** Toggles a session in the form's selected session list. */
  function toggleSession(sessionId: string) {
    setForm((f) => ({
      ...f,
      sessionIds: f.sessionIds.includes(sessionId)
        ? f.sessionIds.filter((id) => id !== sessionId)
        : [...f.sessionIds, sessionId],
    }));
  }

  /** Toggles a class type in the form's selected class type list. */
  function toggleClassType(classTypeId: string) {
    setForm((f) => ({
      ...f,
      classTypeIds: f.classTypeIds.includes(classTypeId)
        ? f.classTypeIds.filter((id) => id !== classTypeId)
        : [...f.classTypeIds, classTypeId],
    }));
  }

  return (
    <div className="flex-1 p-6 max-w-5xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Promo Codes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Create and manage discount codes for sessions, class types, or site-wide.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          + New Code
        </button>
      </div>

      {/* ── Table ── */}
      {codes.length === 0 ? (
        <div className="text-center py-16 text-gray-400 border border-dashed border-gray-200 rounded-xl">
          No promo codes yet. Click &ldquo;New Code&rdquo; to create one.
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Code</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Discount</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Applies to</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Expires</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {codes.map((code) => (
                <tr key={code.id} className="bg-white hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-semibold text-gray-900">{code.code}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatDiscount(code.discount_type, code.discount_value)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatScope(code)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatExpiry(code.expires_at)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(code)}
                      disabled={togglingId === code.id}
                      className={[
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors",
                        code.active
                          ? "bg-green-100 text-green-800 hover:bg-green-200"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200",
                        togglingId === code.id ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                      ].join(" ")}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${code.active ? "bg-green-500" : "bg-gray-400"}`} />
                      {code.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 justify-end">
                      <button
                        onClick={() => openEdit(code)}
                        className="text-xs text-gray-500 hover:text-gray-800 underline"
                      >
                        Edit
                      </button>
                      {deleteConfirmId === code.id ? (
                        <span className="flex items-center gap-2">
                          <button
                            onClick={() => handleDelete(code.id)}
                            disabled={deleting}
                            className="text-xs text-red-600 hover:text-red-800 font-semibold"
                          >
                            {deleting ? "Deleting…" : "Confirm delete"}
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(code.id)}
                          className="text-xs text-red-500 hover:text-red-700 underline"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                {editingId ? "Edit Promo Code" : "New Promo Code"}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Modal body — scrollable */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* Code */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Code <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. SUMMER25"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {/* Discount type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Discount type <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-4">
                  {(["fixed", "percent", "free"] as DiscountType[]).map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="discountType"
                        value={type}
                        checked={form.discountType === type}
                        onChange={() => setForm((f) => ({ ...f, discountType: type, discountValue: "" }))}
                        className="accent-red-600"
                      />
                      <span className="text-sm text-gray-700">
                        {type === "fixed" ? "Fixed ($)" : type === "percent" ? "Percent (%)" : "Free (100%)"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Discount value */}
              {form.discountType !== "free" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {form.discountType === "fixed" ? "Amount off ($)" : "Percent off (%)"}
                    <span className="text-red-500"> *</span>
                  </label>
                  <input
                    type="number"
                    value={form.discountValue}
                    onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
                    min="0"
                    max={form.discountType === "percent" ? "100" : undefined}
                    step="0.01"
                    placeholder={form.discountType === "fixed" ? "10.00" : "20"}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              )}

              {/* Expiry date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expiry date{" "}
                  <span className="text-gray-400 text-xs font-normal">(optional — blank = no expiry)</span>
                </label>
                <input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {/* Scope */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Valid for <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-col gap-2">
                  {([
                    ["all", "All sessions", "Valid for any session site-wide"],
                    ["session_type", "Specific class types", "Valid for any session of the chosen class types"],
                    ["session", "Specific sessions", "Valid only for the individual sessions you select"],
                  ] as [PromoScope, string, string][]).map(([value, label, desc]) => (
                    <label key={value} className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="scope"
                        value={value}
                        checked={form.scope === value}
                        onChange={() => setForm((f) => ({ ...f, scope: value }))}
                        className="mt-0.5 accent-red-600 shrink-0"
                      />
                      <span>
                        <span className="text-sm font-medium text-gray-800">{label}</span>
                        <span className="block text-xs text-gray-500">{desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Class type picker — shown when scope = session_type */}
              {form.scope === "session_type" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Class types <span className="text-red-500">*</span>
                    <span className="text-gray-400 text-xs font-normal ml-2">
                      ({form.classTypeIds.length} selected)
                    </span>
                  </label>
                  {classTypes.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No active class types found.</p>
                  ) : (
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {classTypes.map((ct) => (
                        <label
                          key={ct.id}
                          className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={form.classTypeIds.includes(ct.id)}
                            onChange={() => toggleClassType(ct.id)}
                            className="accent-red-600 shrink-0"
                          />
                          <span className="text-sm text-gray-700">{ct.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Session picker — shown when scope = session */}
              {form.scope === "session" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sessions <span className="text-red-500">*</span>
                    <span className="text-gray-400 text-xs font-normal ml-2">
                      ({form.sessionIds.length} selected)
                    </span>
                  </label>
                  {sessions.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No upcoming sessions found.</p>
                  ) : (
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-52 overflow-y-auto">
                      {sessions.map((s) => (
                        <label
                          key={s.id}
                          className="flex items-start gap-3 px-3 py-2.5 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={form.sessionIds.includes(s.id)}
                            onChange={() => toggleSession(s.id)}
                            className="mt-0.5 accent-red-600 shrink-0"
                          />
                          <span className="text-xs text-gray-700 leading-relaxed">{s.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {formError && (
                <p role="alert" className="text-sm text-red-600">{formError}</p>
              )}
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {submitting ? "Saving…" : editingId ? "Save Changes" : "Create Code"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
