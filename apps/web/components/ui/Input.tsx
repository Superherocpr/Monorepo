/**
 * Input — text input field used across both the public site and admin panel.
 * Styles sourced from DESIGN-SYSTEM.md §10 (Form Inputs).
 * Handles normal, error, and disabled states.
 */
import { type InputHTMLAttributes, useId } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Field label text. Required for accessibility. */
  label: string;
  /** Error message. When provided, renders the field in error state. */
  error?: string;
}

/**
 * Renders a labeled text input with optional error state.
 * Generates a unique id for the label/input association automatically.
 * Forwards all native input props (type, value, onChange, placeholder, etc.).
 * @param label - Visible field label.
 * @param error - Error message to display below the field. Triggers red border.
 * @param className - Additional Tailwind classes on the input element.
 */
export function Input({ label, error, className = "", disabled, ...props }: InputProps) {
  // useId ensures stable, unique ids when multiple Input instances render on the same page
  const id = useId();

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-sm font-semibold text-gray-900 dark:text-white"
      >
        {label}
      </label>
      <input
        {...props}
        id={id}
        disabled={disabled}
        className={[
          "border rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400",
          "focus:outline-none focus:ring-2 focus:border-transparent",
          "dark:bg-gray-800 dark:border-gray-600 dark:text-white dark:placeholder:text-gray-500",
          error
            ? "border-red-500 focus:ring-red-500"
            : "border-gray-300 focus:ring-red-500",
          disabled
            ? "bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
            : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      />
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
