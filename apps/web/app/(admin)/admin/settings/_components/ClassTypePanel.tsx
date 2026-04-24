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
import type { ClassType } from "../page";

interface ClassTypePanelProps {
  open: boolean;
  /** Null when creating a new class type; populated when editing an existing one. */
  classType: ClassType | null;
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
 * @param onClose - Called to dismiss the panel.
 * @param onSaved - Called with a success message after a successful save.
 * @param onError - Called with an error message on failure.
 */
const ClassTypePanel: React.FC<ClassTypePanelProps> = ({
  open,
  classType,
  onClose,
  onSaved,
  onError,
}) => {
  const isEditing = classType !== null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [maxCapacity, setMaxCapacity] = useState("");
  const [price, setPrice] = useState("");
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Populate fields when opening in edit mode, or reset when opening for add
  useEffect(() => {
    if (open) {
      if (classType) {
        setName(classType.name);
        setDescription(classType.description ?? "");
        setDurationMinutes(String(classType.duration_minutes));
        setMaxCapacity(String(classType.max_capacity));
        setPrice(String(classType.price));
        setActive(classType.active);
      } else {
        setName("");
        setDescription("");
        setDurationMinutes("");
        setMaxCapacity("");
        setPrice("");
        setActive(true);
      }
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [open, classType]);

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

    const parsedDuration = parseInt(durationMinutes, 10);
    const parsedCapacity = parseInt(maxCapacity, 10);
    const parsedPrice = parseFloat(price);

    if (isNaN(parsedDuration) || parsedDuration <= 0) {
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
                  Duration (minutes) <span className="text-red-600">*</span>
                </label>
                <input
                  id="ct-duration"
                  type="number"
                  min={1}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  className={inputClass}
                  placeholder="120"
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
