"use client";

/**
 * CoverImageUpload — S3 cover image upload control for the blog editor.
 * Shows current image preview if set, a "Choose image" button, and a remove button.
 * Used by BlogEditorClient.
 */

import { useRef, useState } from "react";

interface CoverImageUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
}

/**
 * Handles cover image selection, uploads to /api/admin/blog/upload-image, and
 * calls onChange with the resulting S3 URL.
 * @param value   - Current cover image URL, or null.
 * @param onChange - Called with the new URL after upload, or null on removal.
 */
export default function CoverImageUpload({ value, onChange }: CoverImageUploadProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File): Promise<void> {
    setError(null);
    setUploading(true);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/admin/blog/upload-image", { method: "POST", body: form });
      const json = (await res.json()) as { success: boolean; url?: string; error?: string };

      if (!json.success || !json.url) {
        setError(json.error ?? "Upload failed");
      } else {
        onChange(json.url);
      }
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">Cover image</label>

      {value ? (
        <div className="relative w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Cover"
            className="w-full h-40 object-cover rounded-lg border border-gray-200"
          />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-2 right-2 bg-white border border-gray-200 text-gray-600 hover:text-red-600 rounded-md px-2 py-1 text-xs shadow-sm transition-colors"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full h-32 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-1 text-sm text-gray-400 hover:border-red-400 hover:text-red-500 transition-colors disabled:opacity-50"
        >
          {uploading ? "Uploading…" : (
            <>
              <span className="text-xl" aria-hidden="true">+</span>
              Choose image
            </>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleInputChange}
      />

      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-gray-400">JPG, PNG or WEBP · max 5 MB · optional</p>
    </div>
  );
}
