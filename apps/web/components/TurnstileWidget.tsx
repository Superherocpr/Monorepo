"use client";

/**
 * TurnstileWidget — Cloudflare Turnstile "I'm not a robot" checkbox.
 * Used by: app/(public)/contact/_components/ContactSection.tsx
 *          app/(public)/_components/legacy/LegacySitePage.tsx
 *
 * Loads the Turnstile JS API on first mount, renders the widget explicitly,
 * and calls onVerify(token) when the user passes the challenge. The token
 * must be sent to the server and verified there via lib/turnstile.ts before
 * the form action is trusted — the client-side widget alone is not a guard.
 *
 * If NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset (e.g. local dev without a key),
 * the component renders nothing so the form remains usable. The matching
 * server check in lib/turnstile.ts also no-ops when its secret is unset.
 */

import { useEffect, useRef } from "react";

/** Cloudflare Turnstile explicit-render JS endpoint. */
const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Subset of the Turnstile JS API we actually call. */
interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "flexible" | "compact";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    }
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface TurnstileWidgetProps {
  /** Cloudflare Turnstile site key (NEXT_PUBLIC_TURNSTILE_SITE_KEY). */
  siteKey: string | undefined;
  /** Called with the verification token when the user passes the challenge. */
  onVerify: (token: string) => void;
  /** Called when the token expires or an error occurs — clear stored token. */
  onExpire?: () => void;
  /** Widget colour theme. Defaults to "light". */
  theme?: "light" | "dark" | "auto";
}

/**
 * Renders the Cloudflare Turnstile checkbox widget.
 * Returns null (rendering nothing) when no site key is configured.
 */
export default function TurnstileWidget({
  siteKey,
  onVerify,
  onExpire,
  theme = "light",
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Keep latest callbacks in refs so the effect can stay stable across re-renders.
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onVerifyRef.current = onVerify;
    onExpireRef.current = onExpire;
  }, [onVerify, onExpire]);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    /** Render the widget once the Turnstile API is available on window. */
    const renderWidget = () => {
      if (cancelled) return;
      if (!containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme,
        callback: (token) => onVerifyRef.current?.(token),
        "expired-callback": () => onExpireRef.current?.(),
        "error-callback": () => onExpireRef.current?.(),
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      // Inject the Turnstile script once per page — multiple widgets share it.
      if (!document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)) {
        const script = document.createElement("script");
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      // Poll until the global appears (script may already be loading from
      // a sibling widget). Cleared on unmount or once we've rendered.
      pollInterval = setInterval(() => {
        if (window.turnstile) {
          if (pollInterval) clearInterval(pollInterval);
          renderWidget();
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignore — widget may have already been torn down by a script reload
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, theme]);

  if (!siteKey) return null;
  return <div ref={containerRef} />;
}
