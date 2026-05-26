"use client";

/**
 * CaptchaCheckbox — Self-contained "I'm not a robot" checkbox widget.
 * Used by: app/(public)/contact/_components/ContactSection.tsx
 *          app/(public)/_components/legacy/LegacySitePage.tsx
 *
 * Requires no external API keys. The user must tick the box before the
 * form allows submission. This is a UX-level spam deterrent; it is NOT
 * a cryptographic challenge. For production hardening, pair it with
 * Cloudflare Turnstile (set NEXT_PUBLIC_TURNSTILE_SITE_KEY +
 * TURNSTILE_SECRET_KEY) — the /api/contact route already verifies a
 * Turnstile token when those keys are present.
 *
 * Props:
 *   checked   — controlled checked state (from parent useState)
 *   onChange  — fires with the new boolean value
 */

import { Shield } from "lucide-react";

interface CaptchaCheckboxProps {
  /** Whether the checkbox is currently ticked. */
  checked: boolean;
  /** Called with the new checked value on every click. */
  onChange: (checked: boolean) => void;
}

/**
 * Renders a styled "I'm not a robot" checkbox widget.
 * The parent form is responsible for blocking submission when checked is false.
 */
export default function CaptchaCheckbox({ checked, onChange }: CaptchaCheckboxProps) {
  return (
    <div
      className={[
        "flex items-center justify-between gap-4",
        "border rounded-md px-4 py-3 select-none",
        "bg-gray-50 dark:bg-gray-800",
        "transition-colors",
        checked
          ? "border-green-500 dark:border-green-600"
          : "border-gray-300 dark:border-gray-600",
      ].join(" ")}
    >
      {/* Clickable checkbox + label */}
      <label className="flex items-center gap-3 cursor-pointer flex-1">
        {/* Hidden native checkbox for accessibility / form semantics */}
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
          aria-label="I'm not a robot"
        />

        {/* Styled square checkbox */}
        <span
          aria-hidden="true"
          className={[
            "flex-shrink-0 w-6 h-6 rounded border-2 flex items-center justify-center",
            "transition-colors",
            checked
              ? "bg-green-500 border-green-500"
              : "bg-white dark:bg-gray-900 border-gray-400 dark:border-gray-500",
          ].join(" ")}
        >
          {checked && (
            <svg
              viewBox="0 0 12 10"
              fill="none"
              className="w-3.5 h-3.5"
              aria-hidden="true"
            >
              <path
                d="M1 5l3.5 3.5L11 1"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>

        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
          I&apos;m not a robot
        </span>
      </label>

      {/* Right-side badge */}
      <div className="flex flex-col items-center gap-0.5 text-gray-400 dark:text-gray-500">
        <Shield size={22} aria-hidden="true" />
        <span className="text-[10px] leading-none tracking-wide uppercase font-medium">
          captcha
        </span>
      </div>
    </div>
  );
}
