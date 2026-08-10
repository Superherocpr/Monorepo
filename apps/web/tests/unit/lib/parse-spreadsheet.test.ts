/**
 * Unit tests for lib/parse-spreadsheet.ts
 *
 * Covers: parseCsvText (pure CSV string parser) and parseXlsxBuffer.
 * parseXlsxBuffer's mapping logic is tested by mocking read-excel-file/browser
 * (a browser-FileReader-based library that doesn't run correctly in jsdom).
 * The library itself is well-tested upstream; what matters here is that our
 * header normalisation, blank-row skipping, and string-coercion logic is correct.
 */
import { describe, test, expect, vi } from "vitest";
import { parseCsvText, parseXlsxBuffer } from "@/lib/parse-spreadsheet";

// Mock the browser-only dynamic import inside parseXlsxBuffer so the test
// controls what "the library returned" and we test our mapping code.
vi.mock("read-excel-file/browser", () => ({
  default: vi.fn(),
}));

describe("parseCsvText", () => {
  test("parses a simple CSV with header and data rows", () => {
    const csv = "Name,Email,Phone\nAlice,alice@example.com,555-1234\nBob,bob@example.com,555-5678";
    const rows = parseCsvText(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Alice", email: "alice@example.com", phone: "555-1234" });
    expect(rows[1]).toEqual({ name: "Bob", email: "bob@example.com", phone: "555-5678" });
  });

  test("lowercases all header names", () => {
    const csv = "FirstName,LastName\nJohn,Doe";
    const rows = parseCsvText(csv);
    expect(rows[0]).toHaveProperty("firstname");
    expect(rows[0]).toHaveProperty("lastname");
  });

  test("trims whitespace from headers and values", () => {
    const csv = " Name , Email \n Alice , alice@example.com ";
    const rows = parseCsvText(csv);
    expect(rows[0]["name"]).toBe("Alice");
    expect(rows[0]["email"]).toBe("alice@example.com");
  });

  test("handles quoted fields containing commas", () => {
    const csv = 'Name,Address\nAlice,"123 Main St, Suite 4"';
    const rows = parseCsvText(csv);
    expect(rows[0]["address"]).toBe("123 Main St, Suite 4");
  });

  test("handles escaped double-quotes inside quoted fields", () => {
    const csv = 'Name,Note\nAlice,"She said ""hello"""';
    const rows = parseCsvText(csv);
    expect(rows[0]["note"]).toBe('She said "hello"');
  });

  test("returns an empty array for a header-only CSV", () => {
    const csv = "Name,Email";
    expect(parseCsvText(csv)).toHaveLength(0);
  });

  test("returns an empty array for an empty string", () => {
    expect(parseCsvText("")).toHaveLength(0);
  });

  test("skips blank lines in the data section", () => {
    const csv = "Name,Email\n\nAlice,alice@example.com\n\nBob,bob@example.com";
    const rows = parseCsvText(csv);
    expect(rows).toHaveLength(2);
  });

  test("handles Windows CRLF line endings", () => {
    const csv = "Name,Email\r\nAlice,alice@example.com\r\nBob,bob@example.com";
    const rows = parseCsvText(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]["name"]).toBe("Alice");
  });

  test("handles rows with fewer columns than the header", () => {
    const csv = "Name,Email,Phone\nAlice,alice@example.com";
    const rows = parseCsvText(csv);
    expect(rows[0]["name"]).toBe("Alice");
    // Missing columns default to empty string
    expect(rows[0]["phone"]).toBe("");
  });
});

// ── parseXlsxBuffer ───────────────────────────────────────────────────────────

describe("parseXlsxBuffer", () => {
  async function setLibraryRows(rawRows: unknown[][]): Promise<void> {
    const mod = await import("read-excel-file/browser");
    vi.mocked(mod.default).mockResolvedValue(rawRows as never);
  }

  test("parses headers and data rows from library output", async () => {
    await setLibraryRows([
      ["Name", "Email", "Phone"],
      ["Alice", "alice@example.com", "555-1234"],
      ["Bob", "bob@example.com", "555-5678"],
    ]);
    const rows = await parseXlsxBuffer(new ArrayBuffer(0));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Alice", email: "alice@example.com", phone: "555-1234" });
    expect(rows[1]).toEqual({ name: "Bob", email: "bob@example.com", phone: "555-5678" });
  });

  test("lowercases and trims header names", async () => {
    await setLibraryRows([[" FirstName ", " LastName "], ["Alice", "Smith"]]);
    const rows = await parseXlsxBuffer(new ArrayBuffer(0));
    expect(rows[0]).toHaveProperty("firstname");
    expect(rows[0]).toHaveProperty("lastname");
  });

  test("converts all cell values to trimmed strings", async () => {
    await setLibraryRows([["Score", "Count"], [100, 42]]);
    const rows = await parseXlsxBuffer(new ArrayBuffer(0));
    expect(rows[0]["score"]).toBe("100");
    expect(rows[0]["count"]).toBe("42");
  });

  test("skips entirely blank rows", async () => {
    await setLibraryRows([
      ["Name", "Email"],
      ["Alice", "alice@example.com"],
      [null, null],
      ["Bob", "bob@example.com"],
    ]);
    const rows = await parseXlsxBuffer(new ArrayBuffer(0));
    expect(rows).toHaveLength(2);
    expect(rows[0]["name"]).toBe("Alice");
    expect(rows[1]["name"]).toBe("Bob");
  });

  test("returns an empty array for a header-only sheet", async () => {
    await setLibraryRows([["Name", "Email"]]);
    const rows = await parseXlsxBuffer(new ArrayBuffer(0));
    expect(rows).toHaveLength(0);
  });

  test("handles missing cells (fewer columns than header)", async () => {
    await setLibraryRows([
      ["Name", "Email", "Phone"],
      ["Alice", "alice@example.com"],
    ]);
    const rows = await parseXlsxBuffer(new ArrayBuffer(0));
    expect(rows[0]["name"]).toBe("Alice");
    expect(rows[0]["phone"]).toBe("");
  });
});
