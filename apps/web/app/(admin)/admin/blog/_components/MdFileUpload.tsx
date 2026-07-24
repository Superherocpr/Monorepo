"use client";

/**
 * MdFileUpload — drag/click to upload a .md file into the blog editor.
 * Extracts the title from the first # heading and populates the body field.
 * Used by BlogEditorClient.
 */

import { useRef, useState } from "react";
import matter from "gray-matter";

interface MdFileUploadProps {
  onImport: (title: string, body: string) => void;
}

/**
 * Parses an uploaded .md file with gray-matter (strips frontmatter if present),
 * extracts the first # heading as the title, then calls onImport.
 * @param onImport - Called with { title, body } extracted from the uploaded file.
 */
export default function MdFileUpload({ onImport }: MdFileUploadProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function processFile(file: File): void {
    if (!file.name.endsWith(".md")) {
      setError("Only .md files are supported.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target?.result as string;
      if (!raw) {
        setError("Could not read file.");
        return;
      }

      // Strip YAML frontmatter if the AI included it.
      const { content } = matter(raw);

      // Extract title from the first # heading line.
      const firstHeadingMatch = content.match(/^#\s+(.+)$/m);
      const title = firstHeadingMatch?.[1]?.trim() ?? "";

      // Body is the full content — the editor will show it with the heading intact.
      onImport(title, content.trim());
      setError(null);
    };
    reader.onerror = () => setError("Failed to read file.");
    reader.readAsText(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLButtonElement>): void {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="w-full py-2 px-3 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-red-400 hover:text-red-600 transition-colors text-left"
      >
        Import .md file — drag here or click to browse
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".md,text/markdown"
        className="hidden"
        onChange={handleChange}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-gray-400">
        Fills the title and body from the file.{" "}
        <a href="/blog-template.md" download className="text-red-600 hover:underline">
          Download template
        </a>
      </p>
    </div>
  );
}
