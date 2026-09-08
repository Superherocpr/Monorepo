"use client";

/**
 * ClassTypeImportPanel: slide-out panel for bulk-importing class types from a
 * CSV or XLSX file.
 * Accepts files in the Enrollware course export format. Required column: Name.
 * Optional columns imported: Description, Class Price.
 * Duration and max capacity default to 60 min / 20 seats after import: the
 * user edits individual records to adjust these values.
 * Used by: SettingsClient (admin/settings → Class Types tab).
 *
 * Posts to POST /api/settings/class-types/import on confirm.
 * Calls onImported with the count of created class types.
 */

import { useRef, useState } from "react";
import { Upload, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { parseSpreadsheetFile, type SpreadsheetRow } from "@/lib/parse-spreadsheet";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single row mapped from the spreadsheet into the expected class type fields. */
interface ParsedRow {
  name: string;
  description: string;
  /** Price as a number, parsed from "Class Price" column (e.g. "$25.00" → 25). */
  price: number | null;
  /** Display string for preview: keeps the raw value visible if parsing fails. */
  priceDisplay: string;
  /** True when the row will be skipped because Name is empty. */
  skip: boolean;
}

/** Result returned by POST /api/settings/class-types/import. */
interface ImportResult {
  success: boolean;
  created: number;
  skipped: number;
  duplicates: number;
  errors: string[];
  message: string;
  error?: string;
}

interface ClassTypeImportPanelProps {
  /** Called when the panel should close. */
  onClose: () => void;
  /**
   * Called after a successful import with the number of class types created.
   * The parent should refresh its class types list.
   */
  onImported: (count: number) => void;
}

// ── Row mapper ────────────────────────────────────────────────────────────────

/**
 * Parses a price string like "$25.00" or "25" into a number.
 * Returns null if the value is empty or cannot be parsed.
 * @param raw - The raw string from the spreadsheet cell.
 */
function parsePrice(raw: string): number | null {
  if (!raw) return null;
  // Strip currency symbols, commas, and whitespace
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) || n < 0 ? null : n;
}

/**
 * Maps a generic spreadsheet row (keyed by lowercased header name) into the
 * structured ParsedRow shape expected by this panel.
 * Handles the Enrollware export header "class price".
 * @param row - Raw row from parseSpreadsheetFile.
 */
function mapRow(row: SpreadsheetRow): ParsedRow {
  const name = (row["name"] ?? "").trim();
  const description = (row["description"] ?? "").trim();
  const rawPrice = (row["class price"] ?? row["price"] ?? "").trim();
  const price = parsePrice(rawPrice);

  return {
    name,
    description,
    price,
    priceDisplay: rawPrice || "-",
    skip: !name,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Slide-out panel that guides the user through a CSV/XLSX import:
 *  1. Pick a file (.csv or .xlsx)
 *  2. Preview parsed rows (skipped rows highlighted)
 *  3. Confirm import → POST /api/settings/class-types/import
 *  4. Show result summary
 *
 * @param onClose - Handler to dismiss the panel.
 * @param onImported - Handler called with the created count on success.
 */
export default function ClassTypeImportPanel({
  onClose,
  onImported,
}: ClassTypeImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const importableCount = rows.filter((r) => !r.skip).length;
  const skippedCount = rows.filter((r) => r.skip).length;

  /**
   * Reads the selected file (CSV or XLSX), parses it, and updates preview state.
   * @param e - The change event from the file input.
   */
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError(null);
    setResult(null);
    setRows([]);

    const parsed = await parseSpreadsheetFile(file);

    if ("error" in parsed) {
      setParseError(parsed.error);
      setFileName(null);
      return;
    }

    const mapped = parsed.rows.map(mapRow);

    if (mapped.length === 0) {
      setParseError('No rows found. Make sure the file has a "Name" header column.');
    } else {
      setRows(mapped);
    }
  }

  /**
   * Sends the parsed rows to POST /api/settings/class-types/import.
   */
  async function handleImport() {
    if (importableCount === 0 || importing) return;

    setImporting(true);
    try {
      const res = await fetch("/api/settings/class-types/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classTypes: rows
            .filter((r) => !r.skip)
            .map((r) => ({
              name: r.name,
              description: r.description || undefined,
              // Send null price as 0: user edits to correct value after import
              price: r.price ?? 0,
            })),
        }),
      });
      const json = (await res.json()) as ImportResult;
      setResult(json);
      if (json.success && json.created > 0) {
        onImported(json.created);
      }
    } catch {
      setResult({
        success: false,
        created: 0,
        skipped: 0,
        duplicates: 0,
        errors: [],
        message: "",
        error: "Network error. Please try again.",
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import class types from spreadsheet"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col bg-white shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Import Class Types
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close import panel"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Format note */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <p className="font-medium mb-1">Expected format</p>
            <p className="text-xs text-blue-700">
              CSV or XLSX. Must have a{" "}
              <code className="font-mono">Name</code> column. Optional:{" "}
              <code className="font-mono">Description</code>,{" "}
              <code className="font-mono">Class Price</code>. Duration and
              capacity default to 60 min / 20 seats; edit each class type
              after import to adjust.
            </p>
          </div>

          {/* File picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              File
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 hover:border-red-400 hover:text-red-600 transition-colors w-full"
            >
              <Upload className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {fileName ?? "Click to choose a .csv or .xlsx file"}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.txt"
              onChange={handleFileChange}
              className="sr-only"
              aria-label="Choose spreadsheet file"
            />
          </div>

          {/* Parse error */}
          {parseError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {parseError}
            </div>
          )}

          {/* Import result banner */}
          {result && (
            <div
              className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
                result.success
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {result.success ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <p>{result.success ? result.message : (result.error ?? result.message)}</p>
            </div>
          )}

          {/* Preview table */}
          {rows.length > 0 && !result && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Preview:{" "}
                <span className="text-gray-900">{importableCount}</span> will
                be imported
                {skippedCount > 0 && (
                  <span className="text-gray-400">
                    {" "}
                    · {skippedCount} skipped (no name)
                  </span>
                )}
              </p>

              <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-72 overflow-y-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">
                        Name
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">
                        Description
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">
                        Price
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide w-16">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((row, i) => (
                      <tr
                        key={i}
                        className={row.skip ? "bg-yellow-50" : "bg-white hover:bg-gray-50"}
                      >
                        <td className="px-3 py-2 text-gray-900 max-w-[140px] truncate">
                          {row.name || (
                            <span className="italic text-gray-400">empty</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-500 max-w-[160px] truncate">
                          {row.description || "-"}
                        </td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                          {row.price !== null
                            ? `$${row.price.toFixed(2)}`
                            : <span className="text-yellow-600">{row.priceDisplay}</span>}
                        </td>
                        <td className="px-3 py-2">
                          {row.skip ? (
                            <span className="text-yellow-600 font-medium">Skip</span>
                          ) : (
                            <span className="text-green-600 font-medium">✓</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">
            Duration and capacity default to 60 min / 20 seats; edit each
            class type after import.
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              {result?.success ? "Close" : "Cancel"}
            </button>
            {!result?.success && (
              <button
                type="button"
                onClick={handleImport}
                disabled={importableCount === 0 || importing}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing
                  ? "Importing…"
                  : `Import ${importableCount} class type${importableCount !== 1 ? "s" : ""}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
