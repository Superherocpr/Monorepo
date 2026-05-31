/**
 * Unit tests for lib/parse-spreadsheet.ts
 *
 * Covers: parseCsvText (pure CSV string parser).
 * parseXlsxBuffer is an async function that depends on the xlsx library and
 * an ArrayBuffer — it is covered by E2E tests.
 */
import { describe, test, expect } from "vitest";
import { parseCsvText } from "@/lib/parse-spreadsheet";

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
