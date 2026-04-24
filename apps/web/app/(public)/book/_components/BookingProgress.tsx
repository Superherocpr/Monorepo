"use client";

/**
 * BookingProgress — horizontal step indicator for the 5-step booking wizard.
 * Displays step labels with active/complete/pending states.
 * Used by: all pages under app/(public)/book/
 */

import { Check } from "lucide-react";

interface BookingProgressProps {
  /** Which step the customer is currently on (1–5) */
  currentStep: 1 | 2 | 3 | 4 | 5;
}

const STEPS = [
  { label: "Select" },
  { label: "Details" },
  { label: "Account" },
  { label: "Payment" },
  { label: "Done" },
];

/**
 * Renders a horizontal 5-step progress bar for the booking wizard.
 * Completed steps show a checkmark; the active step is highlighted in red.
 */
export default function BookingProgress({ currentStep }: BookingProgressProps) {
  return (
    <nav
      aria-label="Booking progress"
      className="w-full py-6 px-4"
    >
      <ol className="flex items-center justify-center max-w-2xl mx-auto">
        {STEPS.map((step, index) => {
          const stepNumber = (index + 1) as 1 | 2 | 3 | 4 | 5;
          const isComplete = stepNumber < currentStep;
          const isActive = stepNumber === currentStep;
          const isPending = stepNumber > currentStep;

          return (
            <li key={step.label} className="flex items-center">
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  aria-current={isActive ? "step" : undefined}
                  className={[
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors duration-150",
                    isComplete
                      ? "bg-red-600 text-white"
                      : isActive
                        ? "bg-red-600 text-white ring-4 ring-red-100"
                        : "bg-gray-100 text-gray-400",
                  ].join(" ")}
                >
                  {isComplete ? (
                    <Check size={14} aria-hidden="true" strokeWidth={3} />
                  ) : (
                    <span>{stepNumber}</span>
                  )}
                </div>
                <span
                  className={[
                    "text-xs font-medium hidden sm:block",
                    isActive
                      ? "text-red-600"
                      : isComplete
                        ? "text-gray-700"
                        : "text-gray-400",
                  ].join(" ")}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line between steps (not after the last step) */}
              {index < STEPS.length - 1 && (
                <div
                  aria-hidden="true"
                  className={[
                    "h-0.5 w-10 sm:w-16 mx-1 sm:mx-2 transition-colors duration-150",
                    isPending && !isActive
                      ? "bg-gray-200"
                      : stepNumber < currentStep
                        ? "bg-red-600"
                        : "bg-gray-200",
                  ].join(" ")}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
