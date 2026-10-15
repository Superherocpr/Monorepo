"use client";

/**
 * WhatsNewList: the release-by-release changelog for staff, with unread entries
 * marked. Opening it records the changelog as read (POST /api/profile/whats-new-seen)
 * and refreshes the layout so the sidebar count clears. The unread marks come
 * from a snapshot taken at first render, so they stay visible for this visit.
 * Used by: app/(admin)/admin/whats-new/page.tsx
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { entryKey, formatReleaseDate, groupByRelease } from "@/lib/changelog";
import type { ChangelogEntry, ChangelogKind } from "@/types/changelog";

interface WhatsNewListProps {
  /** Entries this role may see, newest first. */
  entries: ChangelogEntry[];
  /** entryKey() of each entry not yet read when the page loaded. */
  unreadKeys: string[];
}

const KIND_BADGE: Record<ChangelogKind, { label: string; variant: "success" | "info" | "neutral" }> = {
  new: { label: "New", variant: "success" },
  improved: { label: "Improved", variant: "info" },
  fixed: { label: "Fixed", variant: "neutral" },
};

/** Changelog list grouped by version. Marks everything read once on mount. */
export default function WhatsNewList({ entries, unreadKeys }: WhatsNewListProps) {
  const router = useRouter();
  // Frozen on first render: router.refresh() re-renders the page with an empty
  // unread list, and we still want this visit to show what was new.
  const [unread] = useState(() => new Set(unreadKeys));
  const markedRef = useRef(false);

  useEffect(() => {
    if (unread.size === 0 || markedRef.current) return;
    markedRef.current = true;
    fetch("/api/profile/whats-new-seen", { method: "POST" })
      .then((res) => {
        // Refresh the layout so the sidebar count clears. A failed save just
        // leaves the entries unread for next time; nothing to show the user.
        if (res.ok) router.refresh();
      })
      .catch(() => {});
  }, [unread, router]);

  const releases = groupByRelease(entries);

  if (releases.length === 0) {
    return <p className="text-sm text-gray-500">Nothing to show yet.</p>;
  }

  return (
    <div className="space-y-8">
      {releases.map((release) => (
        <section key={release.version} aria-labelledby={`release-${release.version}`}>
          <div className="flex items-baseline gap-3 mb-3">
            <h2 id={`release-${release.version}`} className="text-lg font-bold text-gray-900">
              Version {release.version}
            </h2>
            <span className="text-sm text-gray-500">{formatReleaseDate(release.date)}</span>
          </div>
          <ul className="space-y-3">
            {release.entries.map((entry) => {
              const badge = KIND_BADGE[entry.kind];
              const isUnread = unread.has(entryKey(entry));
              return (
                <li
                  key={entryKey(entry)}
                  className="bg-white border border-gray-200 rounded-lg p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <h3 className="text-sm font-semibold text-gray-900">{entry.title}</h3>
                    {isUnread && <Badge variant="danger">Unread</Badge>}
                  </div>
                  <p className="text-sm text-gray-700">{entry.summary}</p>
                  {entry.href && (
                    <Link
                      href={entry.href}
                      className="inline-block mt-2 text-sm font-medium text-red-600 hover:text-red-700 underline underline-offset-2"
                    >
                      Go to this feature
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
