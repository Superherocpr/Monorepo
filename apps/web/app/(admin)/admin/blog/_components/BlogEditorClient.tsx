"use client";

/**
 * BlogEditorClient — full blog post editor with split-pane Markdown editing,
 * live HTML preview, SEO check, cover image upload, and .md file import.
 * Used by /admin/blog/new and /admin/blog/[id].
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { remark } from "remark";
import remarkHtml from "remark-html";
import sanitizeHtml from "sanitize-html";
import CoverImageUpload from "./CoverImageUpload";
import MdFileUpload from "./MdFileUpload";
import SeoPanel from "./SeoPanel";
import type { BlogPost, BlogTag } from "@/types/blog";

interface BlogEditorClientProps {
  /** Undefined when creating a new post. */
  post?: BlogPost;
  /** All available tags from the DB. */
  allTags: BlogTag[];
}

/**
 * Converts Markdown to sanitized HTML for the live preview pane.
 * Runs in the browser using the remark + remark-html packages.
 */
async function markdownToHtml(md: string): Promise<string> {
  const processed = await remark().use(remarkHtml, { sanitize: false }).process(md);
  return sanitizeHtml(processed.toString(), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt"],
      "*": ["class"],
    },
  });
}

/**
 * Generates a URL-safe slug from a title string.
 * @param title - The raw title string.
 * @returns A lowercase, hyphenated slug.
 */
function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Full editor with metadata sidebar and split-pane Markdown editor. */
export default function BlogEditorClient({ post, allTags }: BlogEditorClientProps): React.ReactElement {
  const router = useRouter();
  const isEditing = !!post;

  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(isEditing);
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(post?.cover_image_url ?? null);
  const [seoTitle, setSeoTitle] = useState(post?.seo_title ?? "");
  const [seoDescription, setSeoDescription] = useState(post?.seo_description ?? "");
  const [targetKeyword, setTargetKeyword] = useState(post?.target_keyword ?? "");
  const [status, setStatus] = useState<"draft" | "published">(post?.status ?? "draft");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    post?.tags?.map((t) => t.id) ?? []
  );

  const [preview, setPreview] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Auto-generate slug from title unless the user has manually edited it.
  useEffect(() => {
    if (!slugManuallyEdited && title) {
      setSlug(titleToSlug(title));
    }
  }, [title, slugManuallyEdited]);

  // Regenerate preview HTML whenever the body changes.
  const updatePreview = useCallback(async (md: string) => {
    const html = await markdownToHtml(md);
    setPreview(html);
  }, []);

  useEffect(() => {
    void updatePreview(body);
  }, [body, updatePreview]);

  function handleMdImport(importedTitle: string, importedBody: string): void {
    if (importedTitle && !isEditing) {
      setTitle(importedTitle);
      setSlugManuallyEdited(false);
    }
    setBody(importedBody);
  }

  function toggleTag(id: string): void {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function handleSave(targetStatus: "draft" | "published"): Promise<void> {
    if (!title.trim() || !slug.trim()) {
      setSaveError("Title and slug are required.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaved(false);

    const payload = {
      title: title.trim(),
      slug: slug.trim(),
      excerpt: excerpt.trim() || null,
      body,
      cover_image_url: coverImageUrl,
      seo_title: seoTitle.trim() || null,
      seo_description: seoDescription.trim() || null,
      target_keyword: targetKeyword.trim() || null,
      status: targetStatus,
      tag_ids: selectedTagIds,
    };

    const url = isEditing
      ? `/api/admin/blog/posts/${post.id}`
      : "/api/admin/blog/posts";
    const method = isEditing ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as { data: unknown; error: string | null };
      if (json.error) {
        setSaveError(json.error);
      } else {
        setStatus(targetStatus);
        setSaved(true);
        if (!isEditing) {
          // Redirect to the edit page after creation.
          const created = json.data as { id: string };
          router.push(`/admin/blog/${created.id}`);
        }
      }
    } catch {
      setSaveError("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent";
  const labelCls = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <div className="flex flex-col h-full min-h-screen bg-gray-50">
      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <a href="/admin/blog" className="text-sm text-gray-500 hover:text-gray-900">← Blog</a>
          <span className="text-gray-300">|</span>
          <span className="text-sm font-medium text-gray-700">
            {isEditing ? "Edit post" : "New post"}
          </span>
          {status === "published" && (
            <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
              Published
            </span>
          )}
          {status === "draft" && (
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full font-medium">
              Draft
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-600 font-medium">Saved</span>}
          {saveError && <span className="text-xs text-red-600">{saveError}</span>}
          <button
            type="button"
            onClick={() => handleSave("draft")}
            disabled={saving}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            onClick={() => handleSave("published")}
            disabled={saving}
            className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-40 transition-colors"
          >
            {status === "published" ? "Update" : "Publish"}
          </button>
        </div>
      </div>

      {/* ── Main layout ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar: metadata ──────────────────────────────────────── */}
        <aside className="w-72 shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-5 space-y-6">

          {/* MD import */}
          <MdFileUpload onImport={handleMdImport} />

          <hr className="border-gray-100" />

          {/* Title */}
          <div>
            <label className={labelCls}>Title <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Post title"
              className={inputCls}
            />
          </div>

          {/* Slug */}
          <div>
            <label className={labelCls}>Slug <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={slug}
              onChange={(e) => { setSlug(e.target.value); setSlugManuallyEdited(true); }}
              placeholder="url-friendly-slug"
              className={inputCls}
            />
            <p className="text-xs text-gray-400 mt-1">/blog/{slug || "…"}</p>
          </div>

          {/* Excerpt */}
          <div>
            <label className={labelCls}>Excerpt</label>
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={3}
              placeholder="Short summary shown on listing cards and in meta description"
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* Cover image */}
          <CoverImageUpload value={coverImageUrl} onChange={setCoverImageUrl} />

          {/* Tags */}
          <div>
            <label className={labelCls}>Tags</label>
            {allTags.length === 0 ? (
              <p className="text-xs text-gray-400">
                No tags yet.{" "}
                <a href="/admin/blog/tags" className="text-red-600 hover:underline">
                  Manage tags
                </a>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={[
                      "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                      selectedTagIds.includes(tag.id)
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-white text-gray-600 border-gray-300 hover:border-red-400",
                    ].join(" ")}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-2">
              <a href="/admin/blog/tags" className="text-red-600 hover:underline">
                Manage tags
              </a>
            </p>
          </div>

          <hr className="border-gray-100" />

          {/* SEO fields */}
          <div className="space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">SEO</p>

            <div>
              <label className={labelCls}>Target keyword</label>
              <input
                type="text"
                value={targetKeyword}
                onChange={(e) => setTargetKeyword(e.target.value)}
                placeholder="e.g. CPR classes Tampa"
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Meta title</label>
              <input
                type="text"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                placeholder="Defaults to post title"
                className={inputCls}
              />
              <p className={`text-xs mt-1 ${seoTitle.length > 60 ? "text-red-500" : "text-gray-400"}`}>
                {seoTitle.length}/60 chars
              </p>
            </div>

            <div>
              <label className={labelCls}>Meta description</label>
              <textarea
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                rows={3}
                placeholder="Defaults to excerpt"
                className={`${inputCls} resize-none`}
              />
              <p className={`text-xs mt-1 ${seoDescription.length > 160 ? "text-red-500" : "text-gray-400"}`}>
                {seoDescription.length}/160 chars
              </p>
            </div>

            <SeoPanel
              keyword={targetKeyword}
              title={title}
              body={body}
              excerpt={excerpt}
              seoDescription={seoDescription}
            />
          </div>
        </aside>

        {/* ── Center: editor ──────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Editor / preview toggle */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 bg-white">
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className={[
                "px-3 py-1 text-sm rounded-md transition-colors",
                !showPreview ? "bg-gray-100 font-medium text-gray-900" : "text-gray-500 hover:bg-gray-50",
              ].join(" ")}
            >
              Write
            </button>
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className={[
                "px-3 py-1 text-sm rounded-md transition-colors",
                showPreview ? "bg-gray-100 font-medium text-gray-900" : "text-gray-500 hover:bg-gray-50",
              ].join(" ")}
            >
              Preview
            </button>
          </div>

          {/* Write pane */}
          {!showPreview && (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your article in Markdown…&#10;&#10;## Introduction&#10;&#10;Start writing here."
              className="flex-1 w-full p-6 font-mono text-sm text-gray-800 bg-white resize-none focus:outline-none leading-relaxed"
              spellCheck
            />
          )}

          {/* Preview pane */}
          {showPreview && (
            <div
              className="flex-1 overflow-y-auto p-8 bg-white blog-content"
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
