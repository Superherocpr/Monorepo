"use client";

/**
 * BookmarkletSetup client component — /admin/enrollware-tool
 * Handles the "Generate Bookmarklet" flow: calls the generate-key API,
 * displays the resulting bookmarklet code, and shows setup instructions
 * for both desktop and mobile browsers.
 * Used by: apps/web/app/(admin)/admin/enrollware-tool/page.tsx
 */

import { useState } from "react";

/** Props passed in from the server page. */
interface BookmarkletSetupProps {
  /** true if the instructor already has an enrollware-bookmarklet key on file. */
  hasExistingKey: boolean;
  /** The app's base URL used to construct the bookmarklet fetch URL. */
  siteUrl: string;
}

/**
 * Builds the complete bookmark JavaScript string for the given API key and
 * site URL. The key is embedded directly in the bookmark so the bookmarklet
 * is self-contained — no login required when running on enrollware.com.
 */
function buildBookmarkletCode(apiKey: string, siteUrl: string): string {
  const fetchUrl = `${siteUrl}/api/enrollware/bookmarklet`;
  // Preferred approach: inject the script tag so the returned script runs
  // natively (avoids eval/Function failures on pages with strict CSP).
  // window.__SCPR_KEY is set before the script tag is appended so the IIFE
  // can read the API key without it ever appearing in a network request.
  // The onerror fallback evaluates the script text directly via Function
  // for environments that block external script-tag src injection.
  const src = JSON.stringify(fetchUrl);
  return (
    `javascript:(function(){` +
    `window.__SCPR_KEY=${JSON.stringify(apiKey)};` +
    `try{` +
      `var s=document.createElement('script');` +
      `s.src=${src};` +
      `s.onerror=function(){` +
        // onerror fallback: fetch the script text, then use indirect eval
        // (via Function constructor) which keeps the fallback working even if
        // the script-tag src is blocked by CSP
        `fetch(${src}).then(function(r){return r.text()}).then(function(c){(0,eval)(c)}).catch(function(){alert('Could not load SuperheroCPR Enrollware tool. Check your connection.')});` +
      `};` +
      `document.documentElement.appendChild(s);` +
    `}catch(e){` +
      `fetch(${src}).then(function(r){return r.text()}).then(function(c){(0,eval)(c)}).catch(function(){alert('Could not load SuperheroCPR Enrollware tool. Check your connection.')});` +
    `}` +
    `})()`
  );
}

/**
 * Client component that handles API key generation and bookmarklet display.
 * Renders the full setup section shown on the Enrollware Tool admin page.
 */
export default function BookmarkletSetup({
  hasExistingKey,
  siteUrl,
}: BookmarkletSetupProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookmarkletCode, setBookmarkletCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Calls the generate-key endpoint, then builds and stores the bookmarklet code.
   * The raw API key is only available in this response — it is never retrievable again.
   */
  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setBookmarkletCode(null);

    try {
      const res = await fetch("/api/enrollware/generate-key", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to generate key. Try again.");
        return;
      }

      setBookmarkletCode(buildBookmarkletCode(data.key, siteUrl));
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  /** Copies the bookmarklet code to the clipboard. */
  async function handleCopy() {
    if (!bookmarkletCode) return;
    try {
      await navigator.clipboard.writeText(bookmarkletCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard API may be blocked on some mobile browsers — the textarea is still selectable
    }
  }

  return (
    <div className="space-y-6">
      {/* Status + generate button */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-base font-semibold text-gray-900">
          Your Enrollware Bookmarklet
        </h2>

        {hasExistingKey && !bookmarkletCode && (
          <p className="mb-4 text-sm text-gray-500">
            You already have an active bookmarklet key. Generating a new one will{" "}
            <span className="font-medium text-gray-700">
              invalidate your existing saved bookmark
            </span>{" "}
            — you will need to re-save the new one.
          </p>
        )}

        {!hasExistingKey && !bookmarkletCode && (
          <p className="mb-4 text-sm text-gray-500">
            No bookmarklet set up yet. Click below to generate one.
          </p>
        )}

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {!bookmarkletCode && (
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            {loading
              ? "Generating…"
              : hasExistingKey
              ? "Regenerate Bookmarklet"
              : "Generate Bookmarklet"}
          </button>
        )}
      </div>

      {/* Bookmarklet code + instructions — shown after generation */}
      {bookmarkletCode && (
        <>
          {/* The code */}
          <div className="rounded-lg border border-green-200 bg-green-50 p-6">
            <p className="mb-3 text-sm font-semibold text-green-800">
              ✓ Bookmarklet generated! Your API key is embedded below and will never be shown again.
            </p>

            <textarea
              readOnly
              value={bookmarkletCode}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="mb-3 w-full rounded-md border border-green-300 bg-white p-3 font-mono text-xs text-gray-800 focus:outline-none"
              rows={4}
              spellCheck={false}
              autoCorrect="off"
            />

            <button
              onClick={handleCopy}
              className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
            >
              {copied ? "Copied!" : "Copy to Clipboard"}
            </button>
          </div>

          {/* Desktop setup instructions */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Desktop Setup (Chrome / Firefox / Edge)
            </h3>
            <ol className="space-y-2 text-sm text-gray-700">
              <li>
                <span className="font-medium">1.</span> Right-click your browser&apos;s bookmarks bar
                and choose <span className="font-mono text-xs bg-gray-100 px-1 rounded">Add bookmark</span>{" "}
                or <span className="font-mono text-xs bg-gray-100 px-1 rounded">Add page</span>.
              </li>
              <li>
                <span className="font-medium">2.</span> Set the <strong>Name</strong> to something like{" "}
                <span className="font-mono text-xs bg-gray-100 px-1 rounded">🦸 SuperheroCPR</span>.
              </li>
              <li>
                <span className="font-medium">3.</span> Clear the <strong>URL / Address</strong> field and paste
                the code above.
              </li>
              <li>
                <span className="font-medium">4.</span> Save the bookmark.
              </li>
              <li>
                <span className="font-medium">5.</span> Navigate to Enrollware&apos;s{" "}
                <span className="font-mono text-xs bg-gray-100 px-1 rounded">class-edit.aspx?id=new</span>{" "}
                page and click the bookmark to activate the tool.
              </li>
            </ol>
          </div>

          {/* Mobile setup instructions */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Mobile Setup (iOS Safari / Android Chrome)
            </h3>
            <ol className="space-y-2 text-sm text-gray-700">
              <li>
                <span className="font-medium">1.</span>{" "}
                <strong>Copy the code</strong> using the button above.
              </li>
              <li>
                <span className="font-medium">2.</span> In your browser, bookmark{" "}
                <em>any</em> page (tap the Share button on iOS or the menu on Android,
                then &ldquo;Add Bookmark&rdquo; or &ldquo;Add to Bookmarks&rdquo;).
              </li>
              <li>
                <span className="font-medium">3.</span> Open your bookmarks, find the one you just
                saved, and <strong>edit</strong> it.
              </li>
              <li>
                <span className="font-medium">4.</span> Change the <strong>URL / Address</strong> field
                to the code you copied.
              </li>
              <li>
                <span className="font-medium">5.</span> Save. Now whenever you&apos;re on an Enrollware
                class-edit page, tap this bookmark to run the tool.
              </li>
            </ol>
            <p className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              <strong>Note:</strong> On iOS, you may need to type the URL rather than paste it in the
              bookmark editor. Tap the URL field, clear it, then paste.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
