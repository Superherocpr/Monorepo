/**
 * Admin-only theme preference helpers.
 *
 * Dark mode is an opt-in setting for staff and applies ONLY inside the
 * `.admin-theme` wrapper rendered by app/(admin)/layout.tsx. It must never be
 * applied to <html> or <body>, because that is how it would leak onto the
 * public site (rollcall, booking, customer dashboard).
 *
 * Used by: app/(admin)/_components/AdminThemeScope.tsx, admin-theme-store.ts
 */

/** What the staff member chose in Settings. "system" follows the OS. */
export type AdminThemePreference = "light" | "dark" | "system";

/** What is actually painted. */
export type ResolvedAdminTheme = "light" | "dark";

/** localStorage key. Deliberately NOT the legacy "theme" key (see below). */
export const ADMIN_THEME_STORAGE_KEY = "admin-theme";

/** Preferences a staff member can pick, in display order. */
export const ADMIN_THEME_PREFERENCES: readonly AdminThemePreference[] = [
  "light",
  "dark",
  "system",
];

/**
 * Normalises a raw localStorage value into a preference.
 * Anything unrecognised (missing key, tampered value, the legacy "theme" key's
 * values) falls back to "light" so dark mode is strictly opt-in.
 * @param raw - The stored string, or null when the key is absent.
 * @returns A valid preference.
 */
export function parseAdminThemePreference(
  raw: string | null | undefined
): AdminThemePreference {
  return raw === "dark" || raw === "system" ? raw : "light";
}

/**
 * Resolves a preference to the theme that should be painted.
 * @param preference - The stored preference.
 * @param systemPrefersDark - Result of matchMedia("(prefers-color-scheme: dark)").
 * @returns "dark" or "light".
 */
export function resolveAdminTheme(
  preference: AdminThemePreference,
  systemPrefersDark: boolean
): ResolvedAdminTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * Inline script that sets `data-admin-theme` on the wrapper element it is
 * rendered inside, before first paint, so a dark-mode user never sees a
 * light flash. It runs synchronously while the HTML streams in, which is why
 * it cannot be a next/script or an effect. It mirrors parseAdminThemePreference
 * and resolveAdminTheme; admin-theme.test.ts evaluates it to keep them in step.
 * Fails safe: any error leaves the wrapper light.
 */
export const ADMIN_THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  ADMIN_THEME_STORAGE_KEY
)});var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.currentScript.parentElement.setAttribute("data-admin-theme",d?"dark":"light")}catch(e){}})();`;
