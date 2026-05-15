"use client";

/**
 * BioEditPanel component
 * Slide-in panel for editing an instructor's about-page photo and bio description.
 * Uploads the selected photo to S3 via /api/staff/upload-photo, then saves the
 * resulting URL and description text to /api/staff/[id]/bio.
 * Used by: StaffManagement
 */

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { X, Upload } from "lucide-react";
import type { StaffMember } from "./StaffManagement";

interface BioEditPanelProps {
  /** The staff member whose bio is being edited. Null means the panel is closed. */
  member: StaffMember | null;
  /** Called when the panel should close (cancel, Escape, or save complete). */
  onClose: () => void;
  /** Called with a success message after the bio is saved. */
  onSuccess: (message: string) => void;
  /** Called with an error message if saving fails. */
  onError: (message: string) => void;
}

const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 " +
  "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 " +
  "focus:border-transparent";

/** Allowed MIME types validated client-side before upload (server re-validates). */
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];
/** Maximum file size in bytes (5 MB). */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Slide-in panel for editing an instructor's photo and bio description.
 * Traps keyboard focus while open and closes on Escape.
 * @param member - The staff member being edited. Null closes the panel.
 * @param onClose - Called when the panel should be dismissed.
 * @param onSuccess - Called with a success message after saving.
 * @param onError - Called with an error message on failure.
 */
const BioEditPanel: React.FC<BioEditPanelProps> = ({
  member,
  onClose,
  onSuccess,
  onError,
}) => {
  // Description textarea value — initialised from the member's current bio
  const [description, setDescription] = useState("");
  // The photo URL currently saved in the DB (shown as the current photo)
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | null>(null);
  // A newly selected file that hasn't been uploaded yet
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // Object URL for the pending file used to show a local preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Whether the save request is in progress
  const [saving, setSaving] = useState(false);
  // Validation error shown below the file input
  const [fileError, setFileError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset form state whenever a new member is selected
  useEffect(() => {
    if (member) {
      setDescription(member.bio_description ?? "");
      setSavedPhotoUrl(member.bio_photo ?? null);
      setPendingFile(null);
      setPreviewUrl(null);
      setFileError(null);
    }
  }, [member]);

  // Revoke the object URL when the pending file changes or the panel closes
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Trap focus inside the panel and close on Escape
  useEffect(() => {
    if (!member) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
        )
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [member, onClose]);

  /**
   * Handles the file input change event. Validates the selected file's type and
   * size client-side, then creates a local preview URL for display.
   * @param e - The change event from the file input.
   */
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setFileError(null);

    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setFileError("Invalid file type. Please use JPG, PNG, or WEBP.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setFileError("File is too large. Maximum size is 5 MB.");
      return;
    }

    // Revoke the previous preview URL to free memory before creating a new one
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  /**
   * Uploads the pending photo file to S3 via the server-side route.
   * Returns the public URL on success, or null on failure (error is shown via onError).
   */
  async function uploadPhoto(): Promise<string | null> {
    if (!pendingFile) return null;

    const formData = new FormData();
    formData.append("file", pendingFile);

    const res = await fetch("/api/staff/upload-photo", {
      method: "POST",
      body: formData,
    });

    const data: { success: boolean; url?: string; error?: string } = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error ?? "Photo upload failed.");
    }

    return data.url ?? null;
  }

  /**
   * Handles the Save button click. Uploads the photo if a new one is pending,
   * then PATCHes the bio fields via /api/staff/[id]/bio.
   */
  async function handleSave() {
    if (!member) return;
    setSaving(true);

    try {
      // Upload the pending photo and get its URL, or keep the saved URL
      let finalPhotoUrl = savedPhotoUrl;
      if (pendingFile) {
        finalPhotoUrl = await uploadPhoto();
      }

      const res = await fetch(`/api/staff/${member.id}/bio`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bio_photo: finalPhotoUrl,
          bio_description: description.trim() || null,
        }),
      });

      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        onError(data.error ?? "Failed to save bio.");
      } else {
        onSuccess(`Bio updated for ${member.first_name} ${member.last_name}.`);
        onClose();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!member) return null;

  // The photo to show in the preview — pending file takes precedence over saved URL
  const displayPhoto = previewUrl ?? savedPhotoUrl;
  const fullName = `${member.first_name} ${member.last_name}`;

  return (
    <>
      {/* Overlay — click to close */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit bio for ${fullName}`}
        className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-white border-l border-gray-200 z-50 overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Edit About Page Bio</h2>
            <p className="text-sm text-gray-500 mt-0.5">{fullName}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close bio edit panel"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form body */}
        <div className="px-6 py-6 space-y-6 flex-1">

          {/* Photo section */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Headshot Photo
            </label>

            {/* Current / preview image */}
            <div className="relative w-32 h-32 rounded-xl overflow-hidden bg-gray-100 mb-3">
              {displayPhoto ? (
                <Image
                  src={displayPhoto}
                  alt={`Photo preview for ${fullName}`}
                  fill
                  className="object-cover"
                  sizes="128px"
                  // Always unoptimized — this is a small admin panel thumbnail.
                  // Bypasses Next.js image optimization so blob: preview URLs
                  // and any S3 URL work without remotePatterns restrictions.
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
              aria-label="Select photo file"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {displayPhoto ? "Replace Photo" : "Upload Photo"}
            </button>

            {pendingFile && (
              <p className="text-xs text-gray-500 mt-2">
                New photo selected: {pendingFile.name} — will upload when you save.
              </p>
            )}

            {fileError && (
              <p role="alert" className="text-xs text-red-600 mt-2">
                {fileError}
              </p>
            )}

            {/* Allow clearing the photo */}
            {displayPhoto && (
              <button
                type="button"
                onClick={() => {
                  setPendingFile(null);
                  setPreviewUrl(null);
                  setSavedPhotoUrl(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="block text-xs text-red-600 hover:text-red-800 mt-2 underline underline-offset-2"
              >
                Remove photo
              </button>
            )}
          </div>

          {/* Description section */}
          <div>
            <label
              htmlFor="bio-description"
              className="block text-sm font-semibold text-gray-700 mb-1"
            >
              Bio Description
            </label>
            <p className="text-xs text-gray-500 mb-2">
              This paragraph appears on the About page below the instructor&apos;s name.
            </p>
            <textarea
              id="bio-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              placeholder="Write a short bio for the About page…"
              className={`${inputClass} resize-y`}
            />
          </div>
        </div>

        {/* Footer — save / cancel */}
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3 justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-sm font-medium text-gray-600 hover:text-gray-900 px-4 py-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !!fileError}
            className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-5 py-2 rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save Bio"}
          </button>
        </div>
      </div>
    </>
  );
};

export default BioEditPanel;
