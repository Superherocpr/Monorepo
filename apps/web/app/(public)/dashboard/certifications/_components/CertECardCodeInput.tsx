"use client";

/**
 * CertECardCodeInput — inline eCard code editor for the customer certifications page.
 * Renders inside the eCard Code cell of AHACertCard.
 *
 * Behaviour:
 *   - No code set: shows an "Add Code" prompt the customer can click.
 *   - Code set: shows the code with a pencil icon (visible on hover) to edit.
 *   - Editing: shows a compact text input with Save (✓) and Cancel (✕) controls.
 *   - Calls PATCH /api/certifications/[id]/ecard-code on save; updates in-place
 *     without a page refresh.
 *   - When disabled (expired certs): renders the code or em-dash, no edit affordance.
 *
 * Used by: AHACertCard.tsx
 */

import { useState, useRef } from "react";
import { Pencil, Check, X } from "lucide-react";

interface CertECardCodeInputProps {
  /** UUID of the certification row to update. */
  certId: string;
  /** The current eCard code, or null if not yet set. */
  initialCode: string | null;
  /**
   * When true, the field is read-only — no edit affordance is shown.
   * Used for expired certifications where editing serves no purpose.
   */
  disabled?: boolean;
}

/**
 * Inline eCard code field with click-to-edit behaviour.
 * Calls the customer PATCH endpoint to persist changes; updates display without reload.
 * @param certId - UUID of the certification to update
 * @param initialCode - Existing cert_number value (nullable)
 * @param disabled - When true, renders read-only (used for expired certs)
 */
export default function CertECardCodeInput({
  certId,
  initialCode,
  disabled = false,
}: CertECardCodeInputProps) {
  const [code, setCode] = useState<string | null>(initialCode);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialCode ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Opens the edit input, pre-filled with the current code. */
  function startEdit() {
    setDraft(code ?? "");
    setError(null);
    setEditing(true);
    // Defer focus until the input has mounted
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  /** Cancels the edit without saving. */
  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  /**
   * Sends the new eCard code to the API and updates display on success.
   * Side effect: writes to the certifications table via the API route.
   */
  async function save() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/certifications/${certId}/ecard-code`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certNumber: trimmed }),
      });

      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to save");
        return;
      }

      setCode(trimmed);
      setEditing(false);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  // ── Editing state ─────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancelEdit();
          }}
          className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 text-center focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 disabled:opacity-50"
          placeholder="e.g. A1B2C3D4"
          maxLength={100}
          disabled={saving}
          aria-label="eCard code"
        />
        {error && (
          <p className="text-[10px] text-red-600 leading-none">{error}</p>
        )}
        <div className="flex gap-2.5">
          <button
            onClick={save}
            disabled={saving}
            aria-label="Save eCard code"
            className="text-green-600 hover:text-green-700 disabled:opacity-40 transition-colors"
          >
            <Check size={14} strokeWidth={2.5} />
          </button>
          <button
            onClick={cancelEdit}
            disabled={saving}
            aria-label="Cancel"
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40 transition-colors"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    );
  }

  // ── Code is set ───────────────────────────────────────────────────────────
  if (code) {
    return (
      <div className="flex items-center justify-center gap-1 w-full">
        <span className="text-sm text-gray-700">{code}</span>
        {!disabled && (
          <button
            onClick={startEdit}
            aria-label="Edit eCard code"
            title="Edit eCard code"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <Pencil size={11} />
          </button>
        )}
      </div>
    );
  }

  // ── No code yet, read-only (expired cert) ─────────────────────────────────
  if (disabled) {
    return <span className="text-sm text-gray-700">—</span>;
  }

  // ── No code yet, editable ─────────────────────────────────────────────────
  return (
    <button
      onClick={startEdit}
      className="text-xs text-red-600 hover:text-red-700 underline underline-offset-2 transition-colors"
    >
      Add Code
    </button>
  );
}
