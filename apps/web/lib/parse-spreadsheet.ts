/**
 * parseSpreadsheet — browser-side utility for reading CSV and XLSX files into
 * a uniform array-of-objects format. Used by LocationImportPanel and
 * ClassTypeImportPanel.
 *
 * Returns an array where each element is a plain object keyed by the
 * normalised (trimmed, lowercased) header name. All values are strings.
 *
 * XLSX parsing uses the `xlsx` (SheetJS) library which is loaded lazily so
 * it does not bloat pages that don't need it.
 */

/** A single parsed spreadsheet row — keys are lowercased header names. */
export type SpreadsheetRow = Record<string, string>;

/**
 * Parses a CSV string into an array of row objects.
 * Handles RFC 4180 quoted fields (fields containing commas or double-quotes).
 * @param text - Raw file content as a string.
 * @returns Array of row objects keyed by lowercased header name.
 */
export function parseCsvText(text: string): SpreadsheetRow[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current);
    return fields;
  }

  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows: SpreadsheetRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseLine(line);
    const row: SpreadsheetRow = {};
    headers.forEach((h, idx) => {
      row[h] = (fields[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Parses an XLSX file (as an ArrayBuffer) into an array of row objects.
 * Uses the first sheet in the workbook.
 * Lazily imports `xlsx` so the bundle cost is only paid by pages that call this.
 * @param buffer - The file contents as an ArrayBuffer.
 * @returns Array of row objects keyed by lowercased header name.
 */
export async function parseXlsxBuffer(buffer: ArrayBuffer): Promise<SpreadsheetRow[]> {
  // Dynamic import — xlsx is a large library, keep it out of the initial bundle
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  // sheet_to_json with header:1 gives us raw arrays; we handle headers ourselves
  const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  if (rawRows.length < 2) return [];

  const headers = (rawRows[0] as string[]).map((h) =>
    String(h ?? "").trim().toLowerCase()
  );
  const rows: SpreadsheetRow[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const cells = rawRows[i] as string[];
    // Skip entirely blank rows
    if (cells.every((c) => !String(c ?? "").trim())) continue;
    const row: SpreadsheetRow = {};
    headers.forEach((h, idx) => {
      row[h] = String(cells[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Reads a File object and returns parsed rows. Dispatches to parseCsvText or
 * parseXlsxBuffer based on the file extension.
 * @param file - The File to parse.
 * @returns Parsed row objects, or an error string on failure.
 */
export async function parseSpreadsheetFile(
  file: File
): Promise<{ rows: SpreadsheetRow[] } | { error: string }> {
  const isXlsx = file.name.match(/\.xlsx?$/i);
  const isCsv = file.name.match(/\.(csv|txt)$/i);

  if (!isXlsx && !isCsv) {
    return { error: "Please select a .csv or .xlsx file." };
  }

  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onerror = () => resolve({ error: "Failed to read file." });

    if (isXlsx) {
      reader.onload = async (ev) => {
        const buffer = ev.target?.result;
        if (!(buffer instanceof ArrayBuffer)) {
          resolve({ error: "Could not read file." });
          return;
        }
        try {
          const rows = await parseXlsxBuffer(buffer);
          resolve({ rows });
        } catch {
          resolve({ error: "Failed to parse XLSX file." });
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (ev) => {
        const text = ev.target?.result;
        if (typeof text !== "string") {
          resolve({ error: "Could not read file." });
          return;
        }
        resolve({ rows: parseCsvText(text) });
      };
      reader.readAsText(file);
    }
  });
}
