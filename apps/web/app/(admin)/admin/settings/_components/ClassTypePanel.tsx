"use client";

/**
 * ClassTypePanel component
 * Slide-in panel for adding or editing a class type.
 * Pre-fills all fields when editing; empty when adding.
 * Calls POST /api/settings/class-types (new) or PATCH /api/settings/class-types/[id] (edit).
 * Used by: SettingsClient
 */

import React, { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { ClassType, CertTypeOption, Addon } from "../page";

interface ClassTypePanelProps {
  open: boolean;
  /** Null when creating a new class type; populated when editing an existing one. */
  classType: ClassType | null;
  /** All active cert types — used to populate the linked cert type dropdown. */
  certTypeOptions: CertTypeOption[];
  /** All add-ons in the catalog — used to populate the eligibility checklist. */
  addonOptions: Addon[];
  onClose: () => void;
  /** Called with a success message after a successful save. */
  onSaved: (message: string) => void;
  /** Called with an error message on failure. */
  onError: (message: string) => void;
}

const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 " +
  "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 " +
  "focus:border-transparent";

/**
 * Slide-in panel for creating or editing a class type.
 * Traps focus while open and closes on Escape.
 * @param open - Whether the panel is visible.
 * @param classType - The class type to edit, or null for a new one.
 * @param certTypeOptions - Active cert types for the linked cert dropdown.
 * @param onClose - Called to dismiss the panel.
 * @param onSaved - Called with a success message after a successful save.
 * @param onError - Called with an error message on failure.
 */
const ClassTypePanel: React.FC<ClassTypePanelProps> = ({
  open,
  classType,
  certTypeOptions,
  addonOptions,
  onClose,
  onSaved,
  onError,
}) => {
  const isEditing = classType !== null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [maxCapacity, setMaxCapacity] = useState("");
  const [price, setPrice] = useState("");
  const [active, setActive] = useState(true);
  const [isAha, setIsAha] = useState(false);
  // UUID of the linked cert type, or empty string for none
  const [certTypeId, setCertTypeId] = useState("");
  // IDs of add-ons eligible for this class type
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Populate fields when opening in edit mode, or reset when opening for add.
  // Adjusted during render, keyed on which class type the panel is open for, so
  // the fields are right on the first painted frame instead of being written
  // back on a second pass. Closing only clears the key — the hidden fields are
  // left as they are and get repopulated on the next open.
  const openKey = open ? (classType?.id ?? "new") : null;
  const [syncedOpenKey, setSyncedOpenKey] = useState<string | null>(null);
  if (syncedOpenKey !== openKey) {
    setSyncedOpenKey(openKey);
    if (openKey !== null) {
      setName(classType?.name ?? "");
      setDescription(classType?.description ?? "");
      setDurationHours(
        classType ? String(classType.duration_minutes / 60) : ""
      );
      setMaxCapacity(classType ? String(classType.max_capacity) : "");
      setPrice(classType ? String(classType.price) : "");
      setActive(classType ? classType.active : true);
      setIsAha(classType ? classType.is_aha : false);
      setCertTypeId(classType?.cert_type_id ?? "");
      setAddonIds(classType ? classType.addon_ids : []);
    }
  }

  // Focus the first field once the panel is on screen.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => firstInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  // Trap focus and close on Escape
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  /**
   * Submits the class type form.
   * Posts to create or patches to update depending on whether classType is set.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const parsedDurationHours = parseFloat(durationHours);
    const parsedDuration = Math.round(parsedDurationHours * 60);
    const parsedCapacity = parseInt(maxCapacity, 10);
    const parsedPrice = parseFloat(price);

    if (isNaN(parsedDurationHours) || parsedDurationHours <= 0) {
      onError("Duration must be a positive number.");
      return;
    }
    if (isNaN(parsedCapacity) || parsedCapacity <= 0) {
      onError("Max capacity must be a positive number.");
      return;
    }
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      onError("Price must be a valid amount.");
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      duration_minutes: parsedDuration,
      max_capacity: parsedCapacity,
      price: parsedPrice,
      active,
      is_aha: isAha,
      // Send null when no cert type selected so the DB column is explicitly cleared
      cert_type_id: certTypeId || null,
      addon_ids: addonIds,
    };

    setSubmitting(true);
    try {
      const url = isEditing
        ? `/api/settings/class-types/${classType!.id}`
        : "/api/settings/class-types";
      const method = isEditing ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: { success: boolean; error?: string } = await res.json();

      if (!res.ok || !data.success) {
        onError(data.error ?? "Failed to save class type.");
      } else {
        onSaved(
          isEditing
            ? `Class type "${payload.name}" updated.`
            : `Class type "${payload.name}" created.`
        );
      }
    } catch {
      onError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /** Adds or removes an addon ID from the selected set. */
  function toggleAddon(id: string) {
    setAddonIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]
    );
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? "Edit Class Type" : "Add Class Type"}
        className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-white border-l border-gray-200 z-50 overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? "Edit Class Type" : "Add Class Type"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <div className="px-6 py-6 space-y-5 flex-1">
            {/* Name */}
            <div>
              <label
                htmlFor="ct-name"
                className="block text-sm font-semibold text-gray-700 mb-1"
              >
                Name <span className="text-red-600">*</span>
              </label>
              <input
                ref={firstInputRef}
                id="ct-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="e.g. BLS for Healthcare Providers"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="ct-desc"
                className="block text-sm font-semibold text-gray-700 mb-1"
              >
                Description{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="ct-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={`${inputClass} resize-none`}
                placeholder="Shown on the public booking page…"
              />
            </div>

            {/* Duration and capacity */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="ct-duration"
                  className="block text-sm font-semibold text-gray-700 mb-1"
                >
                  Duration (hours) <span className="text-red-600">*</span>
                </label>
                <input
                  id="ct-duration"
                  type="number"
                  min={0.25}
                  step={0.25}
                  value={durationHours}
                  onChange={(e) => setDurationHours(e.target.value)}
                  className={inputClass}
                  placeholder="2"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="ct-capacity"
                  className="block text-sm font-semibold text-gray-700 mb-1"
                >
                  Default Capacity <span className="text-red-600">*</span>
                </label>
                <input
                  id="ct-capacity"
                  type="number"
                  min={1}
                  value={maxCapacity}
                  onChange={(e) => setMaxCapacity(e.target.value)}
                  className={inputClass}
                  placeholder="12"
                  required
                />
              </div>
            </div>

            {/* Price */}
            <div>
              <label
                htmlFor="ct-price"
                className="block text-sm font-semibold text-gray-700 mb-1"
              >
                Price ($) <span className="text-red-600">*</span>
              </label>
              <input
                id="ct-price"
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={inputClass}
                placeholder="75.00"
                required
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-700">Active</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Inactive types are hidden from booking and invoicing.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={active}
                onClick={() => setActive((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 ${
                  active ? "bg-red-600" : "bg-gray-200"
                }`}
              >
                <span className="sr-only">Toggle active</span>
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    active ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* AHA toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-700">AHA Certified</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Mark this as an American Heart Association course. Auto-set when a cert type is selected.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isAha}
                onClick={() => setIsAha((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 ${
                  isAha ? "bg-red-600" : "bg-gray-200"
                }`}
              >
                <span className="sr-only">Toggle AHA certified</span>
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isAha ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Linked cert type */}
            {certTypeOptions.length > 0 && (
              <div>
                <label
                  htmlFor="ct-cert-type"
                  className="block text-sm font-semibold text-gray-700 mb-1"
                >
                  Linked Cert Type{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <select
                  id="ct-cert-type"
                  value={certTypeId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setCertTypeId(next);
                    // Auto-enable AHA when a cert type is selected; auto-disable when cleared.
                    // The toggle below can still be manually overridden after this.
                    setIsAha(next !== "");
                  }}
                  className={inputClass}
                >
                  <option value="">None — no cert issued for this class</option>
                  {certTypeOptions.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  The AHA eCard that students earn when they complete this class.
                </p>
              </div>
            )}

            {/* Add-on eligibility */}
            {addonOptions.length > 0 && (
              <div>
                <p className="block text-sm font-semibold text-gray-700 mb-1">
                  Add-ons{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </p>
                <p className="text-xs text-gray-400 mb-2">
                  Which add-ons instructors may offer on sessions of this class type.
                </p>
                <div className="space-y-2 border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                  {addonOptions
                    .filter((a) => a.active || addonIds.includes(a.id))
                    .map((a) => (
                      <label
                        key={a.id}
                        className="flex items-center gap-2 text-sm text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={addonIds.includes(a.id)}
                          onChange={() => toggleAddon(a.id)}
                          className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                        />
                        <span>
                          {a.name}{" "}
                          <span className="text-gray-400">
                            (${a.price.toFixed(2)})
                            {!a.active && " — inactive"}
                          </span>
                        </span>
                      </label>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors"
            >
              {submitting ? "Saving…" : isEditing ? "Save Changes" : "Add Class Type"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default ClassTypePanel;
