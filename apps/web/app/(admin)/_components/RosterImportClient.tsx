"use client";

/**
 * RosterImportClient — Interactive 4-step roster import flow.
 * Used by: /admin/sessions/[id]/roster
 *
 * Steps:
 *   1. Upload — drag-and-drop or click to browse a CSV file
 *   2. Column Mapping — auto-detect or manually map CSV headers to student fields
 *   3. Editable Preview — review, inline-edit, fix errors before import
 *   4. Result — success banner with import counts
 *
 * Accepts CSV (.csv) and Excel (.xlsx, .xls). CSV is parsed via papaparse;
 * Excel is parsed via read-excel-file (no known CVEs). All cell values are
 * sanitized to strip leading formula-trigger characters before storage.
 * Parsing is done entirely client-side; nothing is uploaded to S3.
 * Actual database writes go through POST /api/roster/import.
 */

import { useState, useRef, useCallback, useId } from "react";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";

// ─── Exported types (consumed by page.tsx) ────────────────────────────────────

/** Minimal session info needed to render the page header. */
export interface RosterSessionInfo {
  id: string;
  starts_at: string;
  max_capacity: number;
  class_type_name: string;
  location_name: string;
}

/** A pending customer-submitted roster upload awaiting manager import. */
export interface PendingUpload {
  id: string;
  file_url: string;
  original_filename: string;
  submitted_by_name: string | null;
  created_at: string;
}

/** Props for RosterImportClient. */
interface Props {
  session: RosterSessionInfo;
  /** Lowercased emails already on the roster — used for duplicate detection. */
  existingEmails: string[];
  pendingUpload: PendingUpload | null;
}

// ─── Internal types ───────────────────────────────────────────────────────────

/** The 4 steps of the import flow. */
type Step = "upload" | "mapping" | "preview" | "result";

/** Column mapping: field name → CSV header string (or "" if not mapped). */
interface ColumnMap {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employer: string;
}

/** A student row in the editable preview stage. */
interface PreviewRow {
  /** Stable identity key for React. */
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employer: string;
  /** Derived: missing first or last name. */
  hasError: boolean;
  /** Derived: email matches an existing roster record (case-insensitive). */
  isDuplicate: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Keywords used to auto-detect CSV column headers. Case-insensitive. */
const AUTO_DETECT: Record<keyof ColumnMap, string[]> = {
  firstName: ["first", "firstname", "first name", "fname"],
  lastName: ["last", "lastname", "last name", "lname"],
  email: ["email", "e-mail", "emailaddress", "email address"],
  phone: ["phone", "phone number", "mobile", "cell"],
  employer: ["employer", "company", "organization", "workplace"],
};

/** Human-readable labels for mapping UI. */
const FIELD_LABELS: Record<keyof ColumnMap, string> = {
  firstName: "First Name",
  lastName: "Last Name",
  email: "Email",
  phone: "Phone",
  employer: "Employer",
};

/** Fields that must be mapped before the import can proceed. */
const REQUIRED_FIELDS: (keyof ColumnMap)[] = ["firstName", "lastName"];

/** Maximum accepted file size in bytes (5MB). */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses a CSV file client-side using papaparse.
 * @param file - The File object from the file input or drop event.
 * @returns A 2D array of strings where the first row is the header row.
 */
function parseCsvFile(file: File): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err),
    });
  });
}

/**
 * Parses an Excel file (.xlsx or .xls) client-side using read-excel-file.
 * Returns rows as 2D string arrays to match the same shape as parseCsvFile.
 * @param file - The Excel File object.
 * @returns A 2D array of strings where the first row is the header row.
 */
async function parseExcelFile(file: File): Promise<string[][]> {
  const rows = await readXlsxFile(file) as unknown as unknown[][];
  // read-excel-file returns typed values; convert everything to trimmed strings
  return rows.map((row) =>
    (row as unknown[]).map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim()))
  );
}

/**
 * Strips leading formula-trigger characters (=, +, -, @) to prevent CSV injection.
 * Only the first character is evaluated — email addresses, phone numbers, and other
 * values that contain these characters mid-string are unaffected.
 * e.g. "user@example.com" → "user@example.com" (unchanged)
 *      "=HYPERLINK(...)" → "HYPERLINK(...)" (formula defused)
 * @param value - Raw cell string from the parsed file.
 * @returns Sanitized string safe for storage and CSV export.
 */
function sanitizeCell(value: string): string {
  return /^[=+\-@]/.test(value) ? value.slice(1) : value;
}

/**
 * Auto-detects which CSV header best matches a field based on keyword matching.
 * @param headers - Array of raw CSV header strings.
 * @param keywords - Keywords that indicate a match for this field.
 * @returns The matching header string, or "" if no match found.
 */
function autoDetectHeader(headers: string[], keywords: string[]): string {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const kw of keywords) {
    const idx = lower.indexOf(kw);
    if (idx !== -1) return headers[idx];
  }
  return "";
}

/**
 * Validates and annotates a preview row with error and duplicate state.
 * @param row - Partially-built preview row (without hasError/isDuplicate).
 * @param existingEmailSet - Set of lowercased emails already on the roster.
 * @returns Annotated PreviewRow.
 */
function annotateRow(
  row: Omit<PreviewRow, "hasError" | "isDuplicate">,
  existingEmailSet: Set<string>
): PreviewRow {
  const hasError = !row.firstName.trim() || !row.lastName.trim();
  const emailKey = row.email.trim().toLowerCase();
  const isDuplicate = emailKey.length > 0 && existingEmailSet.has(emailKey);
  return { ...row, hasError, isDuplicate };
}

// ─── Component ─────────────────────────────────────────────────────────────────

/** Interactive roster import wizard. */
export default function RosterImportClient({
  session,
  existingEmails,
  pendingUpload,
}: Props) {
  const existingEmailSet = new Set(existingEmails);
  const dropZoneId = useId();

  // ── State ──
  const [step, setStep] = useState<Step>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loadingCustomerRoster, setLoadingCustomerRoster] = useState(false);

  /** Raw parsed rows from the CSV (includes header row at index 0). */
  const [rawRows, setRawRows] = useState<string[][]>([]);

  /** Column mapping: field → selected CSV header. */
  const [columnMap, setColumnMap] = useState<ColumnMap>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    employer: "",
  });

  /** Editable student rows in the preview step. */
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);

  /** Import state. */
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    inserted: number;
    skipped: number;
    className: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Derived values ──
  const headers = rawRows.length > 0 ? rawRows[0] : [];
  const previewDataRows = rawRows.slice(1, 4); // First 3 data rows for mapping preview

  const canProceedFromMapping =
    columnMap.firstName !== "" && columnMap.lastName !== "";

  const errorCount = previewRows.filter((r) => r.hasError).length;
  const duplicateCount = previewRows.filter((r) => r.isDuplicate).length;
  const validCount = previewRows.filter(
    (r) => !r.hasError && !r.isDuplicate
  ).length;

  // ── File handling ──

  /**
   * Processes a file after it is selected or dropped.
   * Accepts CSV and Excel; parses client-side and advances to column mapping.
   * Enforces a 5MB size cap and sanitizes all cell values before storing.
   * @param file - The CSV or Excel File object to parse.
   */
  const handleFile = useCallback(async (file: File) => {
    setParseError(null);

    const nameLower = file.name.toLowerCase();
    const isCsv = nameLower.endsWith(".csv");
    const isExcel = nameLower.endsWith(".xlsx") || nameLower.endsWith(".xls");

    if (!isCsv && !isExcel) {
      setParseError("Only CSV and Excel files are accepted (.csv, .xlsx, .xls).");
      return;
    }

    // Reject files over 5MB — large files can freeze or crash the browser tab
    // while being parsed client-side. A roster file should never approach this.
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setParseError("File is too large. Please upload a file under 5MB.");
      return;
    }

    try {
      const rows = isCsv ? await parseCsvFile(file) : await parseExcelFile(file);
      if (rows.length < 2) {
        setParseError("The file appears to be empty or has no data rows.");
        return;
      }

      const detectedHeaders = rows[0];

      // Auto-detect column mappings from header keywords
      const detected: ColumnMap = {
        firstName: autoDetectHeader(detectedHeaders, AUTO_DETECT.firstName),
        lastName: autoDetectHeader(detectedHeaders, AUTO_DETECT.lastName),
        email: autoDetectHeader(detectedHeaders, AUTO_DETECT.email),
        phone: autoDetectHeader(detectedHeaders, AUTO_DETECT.phone),
        employer: autoDetectHeader(detectedHeaders, AUTO_DETECT.employer),
      };

      setFileName(file.name);
      setRawRows(rows);
      setColumnMap(detected);
      setStep("mapping");
    } catch {
      setParseError("Failed to parse the file. Please check the file and try again.");
    }
  }, []);

  /**
   * Loads the customer-submitted roster from its S3 URL and pre-loads it into the
   * import flow. The file is fetched via browser fetch (no server intermediary).
   */
  const handleLoadCustomerRoster = useCallback(async () => {
    if (!pendingUpload) return;
    setLoadingCustomerRoster(true);
    setParseError(null);

    try {
      const res = await fetch(pendingUpload.file_url);
      if (!res.ok) throw new Error("Failed to download the customer roster file.");

      const blob = await res.blob();
      const file = new File([blob], pendingUpload.original_filename, {
        type: blob.type,
      });
      await handleFile(file);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "Could not load the customer roster."
      );
    } finally {
      setLoadingCustomerRoster(false);
    }
  }, [pendingUpload, handleFile]);

  // ── Column mapping → preview ──

  /**
   * Builds the editable preview rows from the current column mapping, then
   * advances to the preview step.
   */
  function buildPreviewAndAdvance() {
    const dataRows = rawRows.slice(1);
    const headerIdx = (h: string) => rawRows[0].indexOf(h);

    const rows: PreviewRow[] = dataRows.map((row, i) => {
      const get = (field: keyof ColumnMap) => {
        const h = columnMap[field];
        if (!h) return "";
        const idx = headerIdx(h);
        const raw = idx !== -1 ? (row[idx] ?? "").trim() : "";
        // Sanitize each cell to strip leading formula-trigger characters
        return sanitizeCell(raw);
      };

      return annotateRow(
        {
          key: `row-${i}`,
          firstName: get("firstName"),
          lastName: get("lastName"),
          email: get("email"),
          phone: get("phone"),
          employer: get("employer"),
        },
        existingEmailSet
      );
    });

    setPreviewRows(rows);
    setStep("preview");
  }

  // ── Inline cell editing ──

  /**
   * Updates a single field on a preview row and re-validates it immediately.
   * @param rowKey - Stable key identifying the row.
   * @param field - The field being edited.
   * @param value - New value from the cell input.
   */
  function handleCellEdit(
    rowKey: string,
    field: keyof Omit<PreviewRow, "key" | "hasError" | "isDuplicate">,
    value: string
  ) {
    setPreviewRows((prev) =>
      prev.map((row) => {
        if (row.key !== rowKey) return row;
        const updated = { ...row, [field]: value };
        return annotateRow(
          {
            key: updated.key,
            firstName: updated.firstName,
            lastName: updated.lastName,
            email: updated.email,
            phone: updated.phone,
            employer: updated.employer,
          },
          existingEmailSet
        );
      })
    );
  }

  // ── Import ──

  /** Submits the valid (non-duplicate, non-error) rows to the API. */
  async function handleImport() {
    setImporting(true);
    setImportError(null);

    const toSubmit = previewRows.filter((r) => !r.hasError && !r.isDuplicate);

    try {
      const res = await fetch("/api/roster/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          students: toSubmit.map((r) => ({
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email || null,
            phone: r.phone || null,
            employer: r.employer || null,
          })),
          rosterUploadId: pendingUpload?.id ?? null,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setImportError(data.error ?? "Import failed. Please try again.");
        return;
      }

      setImportResult({
        inserted: data.inserted,
        skipped: data.skipped,
        className: session.class_type_name,
      });
      setStep("result");
    } catch {
      setImportError("Network error. Please check your connection and try again.");
    } finally {
      setImporting(false);
    }
  }

  // ── Render helpers ──

  /** Step indicator dots shown at the top of every step. */
  function StepIndicator() {
    const steps: { key: Step; label: string }[] = [
      { key: "upload", label: "Upload" },
      { key: "mapping", label: "Map Columns" },
      { key: "preview", label: "Preview" },
      { key: "result", label: "Done" },
    ];
    const order: Step[] = ["upload", "mapping", "preview", "result"];
    const currentIdx = order.indexOf(step);

    return (
      <div className="flex items-center gap-2 mb-8">
        {steps.map(({ key, label }, idx) => {
          const done = idx < currentIdx;
          const active = key === step;
          return (
            <div key={key} className="flex items-center gap-2">
              <div
                className={[
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold",
                  done
                    ? "bg-green-600 text-white"
                    : active
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-500",
                ].join(" ")}
              >
                {done ? "✓" : idx + 1}
              </div>
              <span
                className={[
                  "text-sm font-medium hidden sm:block",
                  active ? "text-gray-900" : "text-gray-500",
                ].join(" ")}
              >
                {label}
              </span>
              {idx < steps.length - 1 && (
                <div
                  className={[
                    "w-8 h-0.5 mx-1",
                    done ? "bg-green-600" : "bg-gray-200",
                  ].join(" ")}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Step 1: Upload ──────────────────────────────────────────────────────────

  function UploadStep() {
    return (
      <div>
        {/* Customer roster banner */}
        {pendingUpload && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900">
                A roster has been submitted by{" "}
                <span className="font-semibold">
                  {pendingUpload.submitted_by_name ?? "a customer"}
                </span>{" "}
                for this class.
              </p>
              <p className="text-xs text-blue-700 mt-0.5">
                Original file: {pendingUpload.original_filename}
              </p>
            </div>
            <button
              onClick={handleLoadCustomerRoster}
              disabled={loadingCustomerRoster}
              className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {loadingCustomerRoster ? "Loading…" : "Load Customer Roster"}
            </button>
          </div>
        )}

        {/* Drop zone */}
        <div
          role="button"
          aria-label="Upload CSV file"
          tabIndex={0}
          id={dropZoneId}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          onClick={() => fileInputRef.current?.click()}
          className={[
            "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors",
            isDragging
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100",
          ].join(" ")}
        >
          <svg
            className="mx-auto mb-4 h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-sm font-medium text-gray-700">
            Drop a file here, or click to browse
          </p>
          <p className="mt-1 text-xs text-gray-500">Accepts .csv, .xlsx, .xls · Max 5MB</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="sr-only"
          aria-label="CSV or Excel file input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // Reset so the same file can be re-selected after an error
            e.target.value = "";
          }}
        />

        {parseError && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {parseError}
          </p>
        )}
      </div>
    );
  }

  // ── Step 2: Column Mapping ──────────────────────────────────────────────────

  function MappingStep() {
    const fields = Object.keys(columnMap) as (keyof ColumnMap)[];

    return (
      <div>
        <p className="mb-1 text-sm text-gray-600">
          <span className="font-medium">{fileName}</span> —{" "}
          {rawRows.length - 1} rows detected
        </p>
        <p className="mb-6 text-sm text-gray-500">
          Map the CSV columns to the student fields below. Auto-detection has
          pre-filled matches where found.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => {
            const isRequired = REQUIRED_FIELDS.includes(field);
            return (
              <div key={field}>
                <label
                  htmlFor={`map-${field}`}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {FIELD_LABELS[field]}
                  {isRequired && (
                    <span className="ml-1 text-red-500" aria-label="required">
                      *
                    </span>
                  )}
                </label>
                <select
                  id={`map-${field}`}
                  value={columnMap[field]}
                  onChange={(e) =>
                    setColumnMap((prev) => ({ ...prev, [field]: e.target.value }))
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">— Not mapped —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {/* Preview of first 3 data rows */}
        {previewDataRows.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Preview (first {previewDataRows.length} rows)
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {fields.map((f) => (
                      <th
                        key={f}
                        className="px-3 py-2 text-left font-medium text-gray-600"
                      >
                        {FIELD_LABELS[f]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {previewDataRows.map((row, i) => (
                    <tr key={i}>
                      {fields.map((f) => {
                        const h = columnMap[f];
                        const idx = h ? headers.indexOf(h) : -1;
                        const val = idx !== -1 ? (row[idx] ?? "") : "—";
                        return (
                          <td
                            key={f}
                            className="px-3 py-2 text-gray-700 max-w-[120px] truncate"
                          >
                            {val || <span className="text-gray-400">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => setStep("upload")}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={buildPreviewAndAdvance}
            disabled={!canProceedFromMapping}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Next: Preview
          </button>
        </div>
      </div>
    );
  }

  // ── Step 3: Editable Preview ────────────────────────────────────────────────

  function PreviewStep() {
    const editableFields: (keyof Omit<
      PreviewRow,
      "key" | "hasError" | "isDuplicate"
    >)[] = ["firstName", "lastName", "email", "phone", "employer"];

    return (
      <div>
        {/* Row count summary */}
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          <span className="font-medium text-green-700">
            {validCount} valid
          </span>
          {duplicateCount > 0 && (
            <span className="font-medium text-yellow-700">
              {duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""} (will be skipped)
            </span>
          )}
          {errorCount > 0 && (
            <span className="font-medium text-red-700">
              {errorCount} error{errorCount !== 1 ? "s" : ""} (must fix before importing)
            </span>
          )}
        </div>

        {/* Editable table */}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs">
              <tr>
                {["First Name", "Last Name", "Email", "Phone", "Employer"].map(
                  (col) => (
                    <th
                      key={col}
                      className="px-3 py-2 text-left font-medium text-gray-600"
                    >
                      {col}
                    </th>
                  )
                )}
                <th className="px-3 py-2 text-left font-medium text-gray-600">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {previewRows.map((row) => {
                const rowBg = row.hasError
                  ? "bg-red-50"
                  : row.isDuplicate
                  ? "bg-yellow-50"
                  : "";

                return (
                  <tr key={row.key} className={rowBg}>
                    {editableFields.map((field) => {
                      const isRequired =
                        field === "firstName" || field === "lastName";
                      const isEmpty =
                        isRequired && !row[field].trim();
                      return (
                        <td key={field} className="px-2 py-1">
                          <input
                            type="text"
                            value={row[field]}
                            onChange={(e) =>
                              handleCellEdit(row.key, field, e.target.value)
                            }
                            aria-label={`${FIELD_LABELS[field as keyof ColumnMap]} for ${row.firstName} ${row.lastName}`}
                            className={[
                              "w-full rounded border px-2 py-1 text-sm focus:outline-none focus:ring-1",
                              isEmpty
                                ? "border-red-400 focus:ring-red-400"
                                : "border-gray-300 focus:ring-blue-400",
                            ].join(" ")}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-xs font-medium whitespace-nowrap">
                      {row.hasError ? (
                        <span className="text-red-700">Missing required field</span>
                      ) : row.isDuplicate ? (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-800">
                          Will be skipped
                        </span>
                      ) : (
                        <span className="text-green-700">Ready</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {importError && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {importError}
          </p>
        )}

        {duplicateCount > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            {duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""} will be
            skipped — these students are already on the roster.
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => setStep("mapping")}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleImport}
            disabled={errorCount > 0 || importing || validCount === 0}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {importing
              ? "Importing…"
              : `Import ${validCount} student${validCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 4: Result ──────────────────────────────────────────────────────────

  function ResultStep() {
    if (!importResult) return null;

    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg
            className="h-8 w-8 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-green-900">
          Successfully imported {importResult.inserted} student
          {importResult.inserted !== 1 ? "s" : ""} into{" "}
          {importResult.className}.
        </h2>
        {importResult.skipped > 0 && (
          <p className="mt-2 text-sm text-green-700">
            {importResult.skipped} duplicate
            {importResult.skipped !== 1 ? "s were" : " was"} skipped.
          </p>
        )}
        <p className="mt-3 text-sm text-green-700">
          Students can now confirm their information at the roster correction
          link for this session.
        </p>
        <a
          href={`/admin/sessions/${session.id}`}
          className="mt-6 inline-block rounded-md bg-green-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
        >
          Back to Session
        </a>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Page header */}
      <div className="mb-6">
        <a
          href={`/admin/sessions/${session.id}`}
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to session
        </a>
        <h1 className="text-2xl font-bold text-gray-900">Import Roster</h1>
        <p className="mt-1 text-sm text-gray-600">
          {session.class_type_name} —{" "}
          {new Date(session.starts_at).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}{" "}
          · {session.location_name}
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 sm:p-8">
        <StepIndicator />

        {step === "upload" && <UploadStep />}
        {step === "mapping" && <MappingStep />}
        {step === "preview" && <PreviewStep />}
        {step === "result" && <ResultStep />}
      </div>
    </div>
  );
}
