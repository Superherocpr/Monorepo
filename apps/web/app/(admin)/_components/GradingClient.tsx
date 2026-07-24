"use client";

/**
 * GradingClient — interactive grading tool for a single class session.
 * Shows all roster_record students for the session with preset grade buttons and a custom grade input.
 * Grades auto-save individually on selection. Shows green checkmark for 2s after save.
 * CCF Compression column is hidden by default; a toggle button in the header reveals it for all students.
 * Used by: app/(admin)/admin/sessions/[id]/grades/page.tsx
 */

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";

// ─── Exported types (used by the server component) ────────────────────────────

/** Minimal session info needed for the grading page header. */
export interface GradingSessionInfo {
  id: string;
  starts_at: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  class_types: { name: string } | null;
  locations: { name: string } | null;
}

/** A roster record row as fetched for the grading tool. */
export interface GradingStudent {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  employer: string | null;
  grade: number | null;
  ccf_compression: number | null;
}

/** A preset grade option from the preset_grades table. */
export interface PresetGrade {
  id: string;
  value: number;
  label: string;
}

// ─── Component props ──────────────────────────────────────────────────────────

interface Props {
  session: GradingSessionInfo;
  students: GradingStudent[];
  presetGrades: PresetGrade[];
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Renders the grading tool UI.
 * Grade and CCF compression state are managed client-side and auto-save to Supabase on entry.
 */
export default function GradingClient({ session, students, presetGrades }: Props) {
  /**
   * Current grade values keyed by roster_record ID.
   * Initialized from server-fetched data; updated as grades are saved.
   */
  const [grades, setGrades] = useState<Record<string, number | null>>(() => {
    const initial: Record<string, number | null> = {};
    for (const s of students) {
      initial[s.id] = s.grade;
    }
    return initial;
  });

  /**
   * Current CCF compression values keyed by roster_record ID.
   * Initialized from server-fetched data; updated as scores are saved.
   */
  const [ccfValues, setCcfValues] = useState<Record<string, number | null>>(() => {
    const initial: Record<string, number | null> = {};
    for (const s of students) {
      initial[s.id] = s.ccf_compression;
    }
    return initial;
  });

  /**
   * Custom grade input values keyed by student ID.
   * Tracked separately so the input field can be a controlled string while awaiting save.
   */
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  /** CCF compression raw input strings keyed by student ID. */
  const [ccfInputs, setCcfInputs] = useState<Record<string, string>>({});

  /** Whether the CCF Compression column is currently visible across all student rows. */
  const [showCcf, setShowCcf] = useState(false);

  /** ID of the student whose grade is currently being saved to Supabase. */
  const [savingId, setSavingId] = useState<string | null>(null);

  /** ID of the student whose CCF score is currently being saved. */
  const [savingCcfId, setSavingCcfId] = useState<string | null>(null);

  /**
   * Set of student IDs that had a grade saved within the last 2 seconds.
   * Drives the green checkmark animation.
   */
  const [recentlySaved, setRecentlySaved] = useState<Set<string>>(new Set());

  /** Set of student IDs that had a CCF score saved within the last 2 seconds. */
  const [recentlySavedCcf, setRecentlySavedCcf] = useState<Set<string>>(new Set());

  /** Student IDs whose last grade save attempt failed. Persists until resolved. */
  const [saveErrors, setSaveErrors] = useState<Set<string>>(new Set());

  /** Student IDs whose last CCF save attempt failed. */
  const [saveCcfErrors, setSaveCcfErrors] = useState<Set<string>>(new Set());

  // ── Derived values ────────────────────────────────────────────────────────

  const gradedCount = useMemo(
    () => Object.values(grades).filter((g) => g !== null).length,
    [grades]
  );

  const total = students.length;
  const allGraded = total > 0 && gradedCount === total;

  // ── Save grade logic ──────────────────────────────────────────────────────

  /**
   * Saves a grade for a single roster_record via the server API route.
   * The direct Supabase client update was silently failing because roster_records
   * has no UPDATE RLS policy — the API route uses the admin client to bypass RLS.
   * Shows a green checkmark for 2 seconds on success.
   * @param studentId - The roster_record id.
   * @param grade - The integer grade value to save.
   */
  const saveGrade = useCallback(
    async (studentId: string, grade: number) => {
      setSavingId(studentId);
      setSaveErrors((prev) => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });

      try {
        const res = await fetch(`/api/sessions/${session.id}/grade`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roster_record_id: studentId, grade }),
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          console.error("[grading] Save failed:", json.error ?? res.status);
          throw new Error(json.error ?? "Save failed");
        }

        setGrades((prev) => ({ ...prev, [studentId]: grade }));

        setRecentlySaved((prev) => new Set(prev).add(studentId));
        setTimeout(() => {
          setRecentlySaved((prev) => {
            const next = new Set(prev);
            next.delete(studentId);
            return next;
          });
        }, 2000);
      } catch {
        setSaveErrors((prev) => new Set(prev).add(studentId));
      } finally {
        setSavingId(null);
      }
    },
    [session.id]
  );

  /**
   * Saves a CCF compression score for a single roster_record.
   * Shows a green checkmark for 2 seconds on success.
   * @param studentId - The roster_record id.
   * @param ccf - The integer CCF compression score to save.
   */
  const saveCcf = useCallback(
    async (studentId: string, ccf: number) => {
      setSavingCcfId(studentId);
      setSaveCcfErrors((prev) => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });

      try {
        const res = await fetch(`/api/sessions/${session.id}/ccf`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roster_record_id: studentId, ccf_compression: ccf }),
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          console.error("[ccf] Save failed:", json.error ?? res.status);
          throw new Error(json.error ?? "Save failed");
        }

        setCcfValues((prev) => ({ ...prev, [studentId]: ccf }));

        setRecentlySavedCcf((prev) => new Set(prev).add(studentId));
        setTimeout(() => {
          setRecentlySavedCcf((prev) => {
            const next = new Set(prev);
            next.delete(studentId);
            return next;
          });
        }, 2000);
      } catch {
        setSaveCcfErrors((prev) => new Set(prev).add(studentId));
      } finally {
        setSavingCcfId(null);
      }
    },
    [session.id]
  );

  // ── Event handlers ────────────────────────────────────────────────────────

  /**
   * Handles a preset grade button click. Saves immediately.
   * @param studentId - The roster_record id.
   * @param value - The preset grade value.
   */
  function handlePresetClick(studentId: string, value: number): void {
    void saveGrade(studentId, value);
  }

  /**
   * Handles blur or Enter key on the custom grade input.
   * Validates that the value is a positive integer before saving.
   * @param studentId - The roster_record id.
   * @param rawValue - The string from the input field.
   */
  function handleCustomGradeSave(studentId: string, rawValue: string): void {
    const parsed = parseInt(rawValue, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      void saveGrade(studentId, parsed);
    }
  }

  /**
   * Handles blur or Enter key on a CCF compression input.
   * @param studentId - The roster_record id.
   * @param rawValue - The string from the input field.
   */
  function handleCcfSave(studentId: string, rawValue: string): void {
    const parsed = parseInt(rawValue, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      void saveCcf(studentId, parsed);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  const sessionDate = new Date(session.starts_at).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-6">

      {/* ── Page header ── */}
      <div className="space-y-1">
        <Link
          href={`/admin/sessions/${session.id}`}
          className="text-sm text-gray-500 hover:text-red-600 transition-colors"
        >
          ← Back to session
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          {session.class_types?.name ?? "Class Session"} - Grading
        </h1>
        <p className="text-sm text-gray-500">
          {sessionDate}
          {session.locations?.name ? ` · ${session.locations.name}` : ""}
        </p>
      </div>

      {/* ── Progress bar + CCF toggle ── */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium text-sm text-gray-700">
            {gradedCount} of {total} students graded
          </span>
          <div className="flex items-center gap-3">
            {allGraded && (
              <span className="text-green-600 font-medium text-xs">
                All done!
              </span>
            )}
            {/* CCF Compression toggle — shown when there are students to grade */}
            {total > 0 && (
              <button
                type="button"
                onClick={() => setShowCcf((v) => !v)}
                aria-pressed={showCcf}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                  showCcf
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-white text-gray-600 border-gray-300 hover:border-red-400 hover:text-red-600"
                }`}
              >
                {/* Heart-pulse icon */}
                <svg
                  className="h-3.5 w-3.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                  />
                </svg>
                CCF Compression
              </button>
            )}
          </div>
        </div>

        <div
          role="progressbar"
          aria-valuenow={gradedCount}
          aria-valuemin={0}
          aria-valuemax={total}
          className="w-full h-2 bg-gray-200 rounded-full overflow-hidden"
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              allGraded ? "bg-green-500" : "bg-red-600"
            }`}
            style={{ width: total > 0 ? `${(gradedCount / total) * 100}%` : "0%" }}
          />
        </div>

        {/* Completion banner */}
        {allGraded && (
          <div className="mt-2 bg-green-50 border border-green-200 rounded-md p-3 flex items-center justify-between gap-4 text-sm text-green-800">
            <span className="font-medium">All students have been graded.</span>
            <Link
              href={`/admin/sessions/${session.id}`}
              className="shrink-0 underline hover:text-green-900 font-medium"
            >
              Back to session →
            </Link>
          </div>
        )}
      </div>

      {/* ── Saving in-progress warning (non-blocking) ── */}
      {(savingId !== null || savingCcfId !== null) && (
        <p className="text-xs text-amber-600 font-medium">Saving…</p>
      )}

      {/* ── Empty state ── */}
      {total === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center space-y-2">
          <svg
            className="mx-auto h-10 w-10 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 20h5v-1a4 4 0 00-5.197-3.77M9 20H4v-1a4 4 0 015.197-3.77m0 0A4 4 0 1112 7a4 4 0 012.803 9.23M15 7a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <p className="text-gray-600 font-medium">
            No students have registered via rollcall for this session yet.
          </p>
          <p className="text-sm text-gray-400">
            Students register at superherocpr.com/rollcall using your daily
            class code.
          </p>
        </div>
      )}

      {/* ── Student list ── */}
      {total > 0 && (
        <ul className="space-y-3">
          {students.map((student) => {
            const currentGrade = grades[student.id] ?? null;
            const isSaving = savingId === student.id;
            const justSaved = recentlySaved.has(student.id);
            const hasError = saveErrors.has(student.id);
            const customInput = customInputs[student.id] ?? "";

            const isSavingCcf = savingCcfId === student.id;
            const justSavedCcf = recentlySavedCcf.has(student.id);
            const hasCcfError = saveCcfErrors.has(student.id);
            const ccfInput = ccfInputs[student.id] ?? "";
            const currentCcf = ccfValues[student.id] ?? null;

            return (
              <li
                key={student.id}
                className="bg-white border border-gray-200 rounded-lg p-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">

                  {/* Student info */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">
                        {student.first_name} {student.last_name}
                      </span>
                      {/* Green checkmark — shown for 2s after successful grade save */}
                      {justSaved && (
                        <svg
                          className="h-4 w-4 text-green-500 shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          aria-label="Grade saved"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                      {hasError && (
                        <span className="text-xs text-red-600 font-medium">
                          Save failed — try again
                        </span>
                      )}
                      {isSaving && (
                        <span className="text-xs text-gray-400">Saving…</span>
                      )}
                    </div>
                    {student.email && (
                      <p className="text-sm text-gray-500">{student.email}</p>
                    )}
                    {student.employer && (
                      <p className="text-sm text-gray-400">{student.employer}</p>
                    )}
                  </div>

                  {/* Grade + optional CCF inputs */}
                  <div className="flex flex-col gap-2 shrink-0">

                    {/* Grade selector row */}
                    <div className="flex flex-wrap items-center gap-2">
                      {presetGrades.map((preset) => {
                        const isSelected = currentGrade === preset.value;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            aria-pressed={isSelected}
                            disabled={isSaving}
                            onClick={() => handlePresetClick(student.id, preset.value)}
                            className={`min-w-[80px] px-3 py-1.5 rounded-md text-sm font-medium border transition-colors disabled:opacity-50 ${
                              isSelected
                                ? "bg-red-600 text-white border-red-600"
                                : "bg-white text-gray-700 border-gray-300 hover:border-red-400 hover:text-red-600"
                            }`}
                          >
                            {preset.value}
                          </button>
                        );
                      })}

                      {/* Custom grade input */}
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={customInput}
                        aria-label={`Custom grade for ${student.first_name} ${student.last_name}`}
                        placeholder="Custom"
                        disabled={isSaving}
                        onChange={(e) => {
                          setCustomInputs((prev) => ({
                            ...prev,
                            [student.id]: e.target.value,
                          }));
                        }}
                        onBlur={(e) => {
                          if (e.target.value.trim() !== "") {
                            handleCustomGradeSave(student.id, e.target.value);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        className="w-24 text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                      />
                    </div>

                    {/* CCF Compression row — only visible when toggled on */}
                    {showCcf && (
                      <div className="flex items-center gap-2">
                        <label
                          htmlFor={`ccf-${student.id}`}
                          className="text-xs font-medium text-gray-500 whitespace-nowrap"
                        >
                          CCF Compression
                        </label>
                        <input
                          id={`ccf-${student.id}`}
                          type="number"
                          min={0}
                          step={1}
                          value={ccfInput !== "" ? ccfInput : (currentCcf !== null ? String(currentCcf) : "")}
                          aria-label={`CCF compression for ${student.first_name} ${student.last_name}`}
                          placeholder="Score"
                          disabled={isSavingCcf}
                          onChange={(e) => {
                            setCcfInputs((prev) => ({
                              ...prev,
                              [student.id]: e.target.value,
                            }));
                          }}
                          onBlur={(e) => {
                            if (e.target.value.trim() !== "") {
                              handleCcfSave(student.id, e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          className="w-24 text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                        />
                        {justSavedCcf && (
                          <svg
                            className="h-4 w-4 text-green-500 shrink-0"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            aria-label="CCF score saved"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2.5}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                        {hasCcfError && (
                          <span className="text-xs text-red-600 font-medium">
                            Save failed
                          </span>
                        )}
                        {isSavingCcf && (
                          <span className="text-xs text-gray-400">Saving…</span>
                        )}
                      </div>
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
