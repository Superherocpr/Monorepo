"use client";

/**
 * BioSettingsSection component
 * Inline form for an instructor to edit their own about-page bio.
 * Uploads headshot to /api/profile/upload-photo, then saves
 * bio_photo, bio_description, and bio_credentials via PATCH /api/profile/bio.
 * bio_published is intentionally absent — admins control publishing via the Staff page.
 * Used by: InstructorSettingsClient (About Page tab)
 */

import React, { useState, useRef } from "react";
import Image from "next/image";
import { Upload } from "lucide-react";

export interface BioSettingsSectionProps {
  /** Current saved headshot URL from the DB. Null if no photo uploaded yet. */
  initialPhoto: string | null;
  /** Current saved bio description from the DB. */
  initialDescription: string;
  /** Current saved credentials string (comma-separated) from the DB. */
  initialCredentials: string;
  /** Called with a success message after a save completes. */
  onSuccess: (message: string) => void;
  /** Called with an error message on failure. */
  onError: (message: string) => void;
}

const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 " +
  "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 " +
  "focus:border-transparent";

/** Allowed MIME types validated client-side before upload (server re-validates). */
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

/** Maximum file size in bytes (5 MB). */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Inline bio editing form for the instructor's About Page settings tab.
 * @param initialPhoto - S3 URL of the saved headshot, or null.
 * @param initialDescription - Saved bio description text.
 * @param initialCredentials - Saved comma-separated credentials string.
 * @param onSuccess - Called with a success message after saving.
 * @param onError - Called with an error message on failure.
 */
const BioSettingsSection: React.FC<BioSettingsSectionProps> = ({
  initialPhoto,
  initialDescription,
  initialCredentials,
  onSuccess,
  onError,
}) => {
  const [description, setDescription] = useState(initialDescription);
  const [credentials, setCredentials] = useState(initialCredentials);
  // The photo URL currently saved in the DB
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | null>(initialPhoto);
  // A newly selected file that hasn't been uploaded yet
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // Object URL for the selected file — used for instant local preview before upload
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Validates the selected file client-side, then creates a local preview URL.
   * @param e - Change event from the hidden file input.
   */
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0] ?? null;
    setFileError(null);
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setFileError("Invalid file type. Please use JPG, PNG, or WEBP.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError("File too large. Maximum size is 5 MB.");
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  /**
   * Uploads the pending file to S3 via the server-side route.
   * @returns The public S3 URL on success.
   * @throws Error with a user-friendly message on failure.
   */
  async function uploadPhoto(): Promise<string> {
    if (!pendingFile) throw new Error("No file to upload.");

    const formData = new FormData();
    formData.append("file", pendingFile);

    const res = await fetch("/api/profile/upload-photo", {
      method: "POST",
      body: formData,
    });
    const data: { success: boolean; url?: string; error?: string } = await res.json();
    if (!res.ok || !data.success || !data.url) {
      throw new Error(data.error ?? "Photo upload failed.");
    }
    return data.url;
  }

  /**
   * Uploads the pending photo (if any) then PATCHes the bio fields.
   * Side effects: S3 object write (if new photo), profiles row update.
   */
  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      let finalPhotoUrl = savedPhotoUrl;
      if (pendingFile) {
        finalPhotoUrl = await uploadPhoto();
        // Update local state so the preview reflects the newly saved URL
        setSavedPhotoUrl(finalPhotoUrl);
        setPendingFile(null);
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl(null);
        }
      }

      const res = await fetch("/api/profile/bio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bio_photo: finalPhotoUrl,
          bio_description: description.trim() || null,
          bio_credentials: credentials.trim() || null,
        }),
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        onError(data.error ?? "Failed to save bio.");
      } else {
        onSuccess("About page bio saved.");
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const displayPhoto = previewUrl ?? savedPhotoUrl;

  return (
    <div className="space-y-8">
      {/* Section header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">About Page Bio</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          This content appears on the public About page when your bio is published. Admins
          control whether your bio is visible.
        </p>
      </div>

      {/* ── Headshot ──────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Headshot Photo</h3>

        {/* Photo preview */}
        <div className="relative w-32 h-32 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700">
          {displayPhoto ? (
            <Image
              src={displayPhoto}
              alt="Headshot preview"
              fill
              className="object-cover"
              sizes="128px"
              // Bypass Next.js optimization — blob: preview URLs and any S3 URL
              // must work without remotePatterns restrictions.
              unoptimized
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs text-center px-2">
              No photo yet
            </div>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
          onChange={handleFileSelect}
          className="sr-only"
          aria-label="Select headshot photo"
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {displayPhoto ? "Replace Photo" : "Upload Photo"}
          </button>

          {displayPhoto && (
            <button
              type="button"
              onClick={() => {
                setSavedPhotoUrl(null);
                setPendingFile(null);
                if (previewUrl) {
                  URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(null);
                }
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="text-xs text-red-600 hover:text-red-800 underline underline-offset-2"
            >
              Remove photo
            </button>
          )}
        </div>

        {pendingFile && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            New photo selected: {pendingFile.name} — will upload when you save.
          </p>
        )}
        {fileError && (
          <p role="alert" className="text-xs text-red-600">{fileError}</p>
        )}
      </div>

      {/* ── Bio Description ───────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 space-y-3">
        <div>
          <label
            htmlFor="bio-description"
            className="block text-sm font-semibold text-gray-900 dark:text-white"
          >
            Bio Description
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            A short paragraph that appears below your name on the About page.
          </p>
        </div>
        <textarea
          id="bio-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          placeholder="Write a short bio for the About page…"
          className={`${inputClass} resize-y`}
        />
      </div>

      {/* ── Credentials ───────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 space-y-3">
        <div>
          <label
            htmlFor="bio-credentials"
            className="block text-sm font-semibold text-gray-900 dark:text-white"
          >
            Credentials
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Separate each credential with a comma. These appear as checkmark items
            under your name on the About page.
          </p>
        </div>
        <textarea
          id="bio-credentials"
          value={credentials}
          onChange={(e) => setCredentials(e.target.value)}
          rows={3}
          placeholder="e.g. Licensed AHA Instructor, BLS Provider, PALS Certified"
          className={`${inputClass} resize-y`}
        />
      </div>

      {/* ── Save button ───────────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !!fileError}
          className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save Bio"}
        </button>
      </div>
    </div>
  );
};

export default BioSettingsSection;
