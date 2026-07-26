"use client";

/**
 * Interactive content shell for the Admin Feature Reference page.
 * Owns search state and renders filtered groups + sections with match highlighting.
 * Used by: /admin/reference
 */

import { useState, useMemo, useRef, useCallback } from "react";
import { Search, X } from "lucide-react";
import {
  GROUPS,
  ROLE_LABELS,
  ROLE_CLASSES,
  TOTAL_SECTIONS,
  type GroupDef,
  type RoleKey,
} from "./referenceData";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolves a section URL to a navigable admin path.
 * URLs containing /[id] are trimmed to the segment before the dynamic parameter
 * so clicking always lands on a real page (e.g. /admin/sessions/[id]/grades → /admin/sessions).
 */
function resolveUrl(url: string): string {
  const idIndex = url.indexOf("/[id]");
  return idIndex !== -1 ? url.slice(0, idIndex) : url;
}

/**
 * Returns whether a section matches the query — checked against name, URL, and bullets.
 * @param query - Lowercase trimmed search string.
 */
function sectionMatches(
  section: GroupDef["sections"][number],
  query: string
): boolean {
  return (
    section.name.toLowerCase().includes(query) ||
    section.url.toLowerCase().includes(query) ||
    section.bullets.some((b) => b.toLowerCase().includes(query))
  );
}

// ── Main component ──────────────────────────────────────────────────────────

/**
 * Renders the full reference page with a live search bar.
 * All filtering and highlighting is done client-side from the static GROUPS data.
 */
export default function ReferenceContent(): React.ReactElement {
  const [rawQuery, setRawQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const query = rawQuery.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!query) return GROUPS;
    return GROUPS.map((group) => ({
      ...group,
      sections: group.sections.filter((s) => sectionMatches(s, query)),
    })).filter((group) => group.sections.length > 0);
  }, [query]);

  const matchCount = filteredGroups.reduce(
    (n, g) => n + g.sections.length,
    0
  );

  const clearSearch = useCallback(() => {
    setRawQuery("");
    inputRef.current?.focus();
  }, []);

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="max-w-6xl">

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-700">
          <p className="text-xs font-semibold uppercase tracking-widest text-red-600 dark:text-red-400 mb-2">
            SuperheroCPR
          </p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Admin Feature Reference
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-xl">
            A page-by-page guide to every section of the admin dashboard — what
            it does and who can access it.
          </p>
          {/* Role legend */}
          <div className="mt-4 flex flex-wrap gap-3">
            {(Object.entries(ROLE_LABELS) as [RoleKey, string][]).map(
              ([key, label]) => (
                <span
                  key={key}
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${ROLE_CLASSES[key]}`}
                >
                  {label}
                </span>
              )
            )}
            <span className="text-xs text-gray-400 dark:text-gray-500 self-center">
              — access level required
            </span>
          </div>
        </div>

        {/* ── Search bar ──────────────────────────────────────────────────── */}
        <div className="mb-6">
          <div className="relative max-w-lg">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              type="search"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && rawQuery) clearSearch();
              }}
              placeholder="Search pages, features, URLs…"
              aria-label="Search reference"
              className={
                "w-full border rounded-lg pl-9 pr-9 py-2.5 text-sm bg-white " +
                "text-gray-900 placeholder:text-gray-400 " +
                "focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent " +
                "dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500 " +
                (query
                  ? "border-red-300 dark:border-red-700"
                  : "border-gray-300 dark:border-gray-600")
              }
            />
            {rawQuery && (
              <button
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Result count */}
          {query && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {matchCount === 0 ? (
                <>No results for &ldquo;{rawQuery.trim()}&rdquo;</>
              ) : (
                <>
                  {matchCount} of {TOTAL_SECTIONS} section
                  {matchCount !== 1 ? "s" : ""} match
                </>
              )}
            </p>
          )}
        </div>

        {/* ── Two-column layout ────────────────────────────────────────────── */}
        <div className="lg:grid lg:grid-cols-[1fr_13rem] lg:gap-10">

          {/* Main content */}
          <main className="space-y-10 min-w-0">
            {filteredGroups.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  No sections match &ldquo;{rawQuery.trim()}&rdquo;
                </p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Try a different keyword, a URL fragment, or a role name.
                </p>
                <button
                  onClick={clearSearch}
                  className="mt-4 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline underline-offset-2"
                >
                  Clear search
                </button>
              </div>
            ) : (
              filteredGroups.map((group) => (
                <div key={group.id} id={group.id}>
                  {/* Group divider */}
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-[0.65rem] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {group.label}
                    </span>
                    <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                  </div>

                  {/* Section cards */}
                  <div className="space-y-3">
                    {group.sections.map((section) => (
                      <a
                        key={section.id}
                        id={section.id}
                        href={resolveUrl(section.url)}
                        className="block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:border-red-300 dark:hover:border-red-700 transition-colors group cursor-pointer"
                      >
                        {/* Card header */}
                        <div className="flex flex-wrap items-center gap-2 px-5 py-3 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 group-hover:bg-red-50/40 dark:group-hover:bg-red-900/10 transition-colors">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {section.name}
                          </span>
                          <code className="text-[0.67rem] font-mono bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded">
                            {section.url}
                          </code>
                          <span
                            className={`ml-auto text-[0.62rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${ROLE_CLASSES[section.role]}`}
                          >
                            {ROLE_LABELS[section.role]}
                          </span>
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-red-500 dark:text-red-400 text-sm font-medium leading-none">
                            →
                          </span>
                        </div>

                        {/* Bullet list */}
                        <ul className="px-5 py-3.5 space-y-1.5">
                          {section.bullets.map((bullet, i) => (
                            <li
                              key={i}
                              className="flex gap-2.5 text-sm text-gray-600 dark:text-gray-400"
                            >
                              <span
                                className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600"
                                aria-hidden="true"
                              />
                              {bullet}
                            </li>
                          ))}
                        </ul>
                      </a>
                    ))}
                  </div>
                </div>
              ))
            )}
          </main>

          {/* ── Sticky TOC — desktop only ──────────────────────────────────── */}
          <aside className="hidden lg:block">
            <nav className="sticky top-8" aria-label="Page sections">
              <p className="text-[0.62rem] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">
                {query
                  ? `${matchCount} result${matchCount !== 1 ? "s" : ""}`
                  : "On this page"}
              </p>
              {filteredGroups.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  No matches
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {filteredGroups.map((group) => (
                    <li key={group.id}>
                      <a
                        href={`#${group.id}`}
                        className="block py-1 text-xs font-semibold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
                      >
                        {group.label}
                      </a>
                      <ul className="pl-3 mb-1">
                        {group.sections.map((section) => (
                          <li key={section.id}>
                            <a
                              href={`#${section.id}`}
                              className="block py-0.5 text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                            >
                              {section.name}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </nav>
          </aside>

        </div>
      </div>
    </div>
  );
}
