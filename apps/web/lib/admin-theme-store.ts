"use client";

/**
 * Client store + hook for the admin theme preference.
 * The preference lives in localStorage (external mutable state), so it is read
 * through useSyncExternalStore instead of being mirrored into React state.
 * Writes go through setPreference so subscribers in this tab are notified too:
 * the browser's own `storage` event only fires for changes made in OTHER tabs.
 * "system" also subscribes to the OS color-scheme query.
 *
 * Used by: AdminThemeScope, Settings (Appearance), AdminTopBar, TourButton
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  ADMIN_THEME_STORAGE_KEY,
  parseAdminThemePreference,
  resolveAdminTheme,
  type AdminThemePreference,
  type ResolvedAdminTheme,
} from "@/lib/admin-theme";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Returns the OS color-scheme query, or null where matchMedia is unavailable
 * (very old browsers, jsdom). Callers treat null as "OS prefers light".
 */
function getSystemQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(SYSTEM_DARK_QUERY)
    : null;
}

/** Callbacks React registered to hear about preference changes in this tab. */
const subscribers = new Set<() => void>();

/**
 * Subscribes to preference changes (this tab, other tabs) and OS scheme changes.
 * @param onChange - Called whenever the resolved theme may have changed.
 * @returns An unsubscribe function.
 */
function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  window.addEventListener("storage", onChange);
  const query = getSystemQuery();
  query?.addEventListener("change", onChange);
  return () => {
    subscribers.delete(onChange);
    window.removeEventListener("storage", onChange);
    query?.removeEventListener("change", onChange);
  };
}

/** Reads the stored preference; a blocked localStorage reads as "light". */
function getPreference(): AdminThemePreference {
  try {
    return parseAdminThemePreference(localStorage.getItem(ADMIN_THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

/** Reads the OS color-scheme setting. */
function getSystemPrefersDark(): boolean {
  return getSystemQuery()?.matches ?? false;
}

/** SSR has no localStorage or matchMedia; light is the default until the client corrects it. */
function getServerPreference(): AdminThemePreference {
  return "light";
}

/** SSR counterpart of getSystemPrefersDark. */
function getServerSystemPrefersDark(): boolean {
  return false;
}

/**
 * Persists a preference and notifies every subscriber.
 * Side effects: writes localStorage (silently ignored if storage is blocked).
 * @param preference - The preference to store.
 */
function writePreference(preference: AdminThemePreference): void {
  try {
    localStorage.setItem(ADMIN_THEME_STORAGE_KEY, preference);
  } catch {
    // Blocked storage: the choice simply does not persist this session.
  }
  subscribers.forEach((notify) => notify());
}

/** Return shape of useAdminTheme. */
export interface AdminThemeState {
  /** What the staff member picked. */
  preference: AdminThemePreference;
  /** What is actually painted ("system" resolved against the OS). */
  resolved: ResolvedAdminTheme;
  /** Stores a new preference. */
  setPreference: (preference: AdminThemePreference) => void;
}

/**
 * Reads and updates the admin theme preference.
 * @returns The preference, the resolved theme, and a setter.
 */
export function useAdminTheme(): AdminThemeState {
  const preference = useSyncExternalStore(subscribe, getPreference, getServerPreference);
  const systemPrefersDark = useSyncExternalStore(
    subscribe,
    getSystemPrefersDark,
    getServerSystemPrefersDark
  );
  const setPreference = useCallback(
    (next: AdminThemePreference): void => writePreference(next),
    []
  );
  return {
    preference,
    resolved: resolveAdminTheme(preference, systemPrefersDark),
    setPreference,
  };
}
