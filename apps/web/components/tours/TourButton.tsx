"use client";

/**
 * TourButton: reusable trigger for an instructor guided walkthrough.
 * Wraps Driver.js (https://driverjs.com) behind a single "Need help?" button
 * that highlights real on-page elements in order, so the instructor performs
 * the actual task instead of just reading about it.
 * Used by: any admin page that offers a step-by-step walkthrough of a task.
 *
 * Driver.js touches `document` on init, so this must stay a client component.
 */

import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { CircleHelp } from "lucide-react";
import { BASE_TOUR_CONFIG } from "./tourConfig";

interface TourButtonProps {
  /**
   * Stable identifier for this walkthrough, matching its lib/tours/registry.ts
   * entry. Also doubles as the auto-launch trigger: if the page loads with
   * `?tour=<id>` in the URL (e.g. from the How-To Guides list), the tour
   * starts automatically instead of requiring a second click.
   */
  id: string;
  /** Ordered walkthrough steps; each targets one on-page element via a CSS selector (use `data-tour="..."`, not class names). */
  steps: DriveStep[];
  /** Button label. Defaults to "Need help? Start walkthrough". */
  label?: string;
  /** Additional Tailwind classes to merge onto the trigger button. */
  className?: string;
}

/**
 * Renders a button that launches a Driver.js walkthrough over the current page.
 * Also auto-launches the tour when the URL's `?tour=` param matches `id`.
 * @param id - Stable identifier, also the auto-launch `?tour=` match value.
 * @param steps - Ordered steps, each with an `element` selector and `popover` copy.
 * @param label - Trigger button text.
 * @param className - Extra classes for the trigger button.
 */
export default function TourButton({
  id,
  steps,
  label = "Need help? Start walkthrough",
  className = "",
}: TourButtonProps) {
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const searchParams = useSearchParams();

  // Tear down an in-progress tour if the page unmounts (e.g. instructor
  // navigates away mid-walkthrough) so the overlay never gets orphaned.
  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
    };
  }, []);

  const startTour = useCallback((): void => {
    driverRef.current?.destroy();
    driverRef.current = driver({ ...BASE_TOUR_CONFIG, steps });
    driverRef.current.drive();
  }, [steps]);

  // Auto-launch when arriving via a How-To Guides "Start" link (?tour=<id>),
  // then strip the param so a refresh doesn't relaunch it. No "already ran"
  // ref guard here on purpose: window.history.replaceState doesn't update
  // Next's searchParams, so in real usage this effect only ever fires once
  // (searchParams/id/startTour are all stable across renders). Under dev-only
  // React StrictMode, the effect *does* fire a second time after its sibling
  // cleanup above destroys the first tour on the simulated remount — a guard
  // here would block that restart and leave the tour destroyed with no way
  // back, which is worse than the harmless no-op of stripping an already-gone
  // param. startTour() itself is safe to call twice: it destroys any existing
  // instance before creating the next one.
  useEffect(() => {
    if (searchParams.get("tour") !== id) return;
    startTour();
    const url = new URL(window.location.href);
    url.searchParams.delete("tour");
    window.history.replaceState({}, "", url.pathname + url.search);
  }, [searchParams, id, startTour]);

  return (
    <button
      type="button"
      onClick={startTour}
      className={[
        "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950 transition-colors",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <CircleHelp className="w-4 h-4" />
      {label}
    </button>
  );
}
