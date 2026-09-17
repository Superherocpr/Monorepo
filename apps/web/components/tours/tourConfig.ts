/**
 * Shared Driver.js config defaults for all instructor guided walkthroughs.
 * Used by: components/tours/TourButton.tsx
 * Keeps button labels, progress copy, and overlay styling consistent across
 * every tour instead of each call site reinventing them.
 */

import type { Config } from "driver.js";

/**
 * Base Driver.js config merged into every tour before its own `steps`.
 * Plain-English button labels and a visible step counter are deliberate:
 * the audience is largely non-technical, so the controls must be
 * unambiguous rather than relying on icons or driver.js's defaults.
 */
export const BASE_TOUR_CONFIG: Config = {
  showProgress: true,
  progressText: "Step {{current}} of {{total}}",
  allowClose: true,
  smoothScroll: true,
  stagePadding: 8,
  stageRadius: 6,
  overlayOpacity: 0.5,
  nextBtnText: "Next",
  prevBtnText: "Back",
  doneBtnText: "Done",
};
