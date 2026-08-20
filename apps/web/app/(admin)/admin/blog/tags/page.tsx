/**
 * Admin Blog Tags Page — /admin/blog/tags
 * Lists all tags with post counts, and allows creating or deleting tags.
 * Auth: super_admin only.
 */

"use client";

import { useEffect, useState } from "react";
import type { BlogTag } from "@/types/blog";
import Link from "next/link";

interface TagWithCount extends BlogTag {
  post_count: number;
}

/**
 * Renders the tag management UI. Fetches tags client-side so deletes
 * and creates can refresh without a full page reload.
 */
export default function BlogTagsPage(): React.ReactElement {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deliberately does not set `loading` back to true. On mount it already
  // starts true, and on the refetches after create/delete keeping the current
  // list on screen avoids a spinner flash over data that is about to reappear.
  async function fetchTags(): Promise<void> {
    const res = await fetch("/api/admin/blog/tags");
    const json = (await res.json()) as { data: BlogTag[] | null; error: string | null };
    setTags(
      (json.data ?? []).map((t) => ({ ...t, post_count: 0 }))
    );
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchTags is async; setState calls happen after the network round-trip, not synchronously
  useEffect(() => { void fetchTags(); }, []);

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name = newTagName.trim();
    if (!name) return;

    setSaving(true);
    setError(null);

    const res = await fetch("/api/admin/blog/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = (await res.json()) as { data: BlogTag | null; error: string | null };

    if (json.error) {
      setError(json.error);
    } else {
      setNewTagName("");
      void fetchTags();
    }

    setSaving(false);
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm("Delete this tag? It will be removed from all posts.")) return;

    const res = await fetch(`/api/admin/blog/tags/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { error: string | null };

    if (json.error) {
      setError(json.error);
    } else {
      void fetchTags();
    }
  }

  return (
    <div className="p-6 max-w-xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/blog" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
          ← Blog posts
        </Link>
        <span className="text-gray-300">|</span>
        <h1 className="text-xl font-bold text-gray-900">Manage tags</h1>
      </div>

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <input
          type="text"
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          placeholder="New tag name"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={saving || !newTagName.trim()}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
        >
          {saving ? "Adding…" : "Add tag"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {/* Tag list */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : tags.length === 0 ? (
        <p className="text-sm text-gray-400">No tags yet. Add your first tag above.</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{tag.name}</p>
                <p className="text-xs text-gray-400">/blog/tag/{tag.slug}</p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(tag.id)}
                className="text-xs text-gray-400 hover:text-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
