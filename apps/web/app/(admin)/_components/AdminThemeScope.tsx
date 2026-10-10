"use client";

/**
 * AdminThemeScope: the single element that carries the admin theme.
 * Renders the flex shell for every /admin/* page and sets data-admin-theme on
 * ITSELF (never on <html> or <body>), so dark mode cannot reach the public site.
 * The inline script sets the attribute before first paint to avoid a light flash.
 * Used by: app/(admin)/layout.tsx
 */

import { ADMIN_THEME_INIT_SCRIPT } from "@/lib/admin-theme";
import { useAdminTheme } from "@/lib/admin-theme-store";

/** Wraps the admin chrome and page content in the themed shell. */
export default function AdminThemeScope({ children }: { children: React.ReactNode }) {
  const { resolved } = useAdminTheme();

  return (
    // suppressHydrationWarning: the init script may set data-admin-theme="dark"
    // before React hydrates, while the server snapshot renders "light". React
    // corrects the attribute on its first client render.
    <div className="admin-theme flex min-h-screen" data-admin-theme={resolved} suppressHydrationWarning>
      {/*
       * Must be a raw inline <script> that is the FIRST child of the wrapper: it
       * finds the wrapper through document.currentScript.parentElement. Runs while
       * the HTML streams in, before first paint (same constraint as the root layout
       * script that used to live here; do not convert to next/script).
       */}
      <script dangerouslySetInnerHTML={{ __html: ADMIN_THEME_INIT_SCRIPT }} />
      {children}
    </div>
  );
}
