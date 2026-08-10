/**
 * Unit tests for GET /api/enrollware/student-xlsx
 *
 * Verifies that the route produces a valid XLSX response with the correct
 * column headers and student data. The Supabase client and API key
 * validation are mocked; ExcelJS is NOT mocked so the real workbook
 * generation path is exercised.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { GET } from "@/app/api/enrollware/student-xlsx/route";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/enrollware-api-auth", () => ({
  validateEnrollwareKey: vi.fn(),
  enrollwareCorsHeaders: vi.fn().mockReturnValue({}),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(sessionId: string): NextRequest {
  return new NextRequest(`http://localhost/api/enrollware/student-xlsx?sessionId=${sessionId}`);
}

/** Parse a Response body back into an ExcelJS workbook for assertions. */
async function parseResponseAsWorkbook(response: Response): Promise<ExcelJS.Workbook> {
  const buffer = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/enrollware/student-xlsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 401 when API key is invalid", async () => {
    const { validateEnrollwareKey } = await import("@/lib/enrollware-api-auth");
    vi.mocked(validateEnrollwareKey).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const res = await GET(makeRequest("session-123") as never);
    expect(res.status).toBe(401);
  });

  test("returns 400 when sessionId is missing", async () => {
    const { validateEnrollwareKey } = await import("@/lib/enrollware-api-auth");
    vi.mocked(validateEnrollwareKey).mockResolvedValue({ ok: true, profileId: "profile-1" } as never);

    const req = new NextRequest("http://localhost/api/enrollware/student-xlsx");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  test("returns 404 when session does not belong to the instructor", async () => {
    const { validateEnrollwareKey } = await import("@/lib/enrollware-api-auth");
    vi.mocked(validateEnrollwareKey).mockResolvedValue({ ok: true, profileId: "profile-1" } as never);

    const { createAdminClient } = await import("@/lib/supabase/server");
    const mockSelect = { eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }) };
    vi.mocked(createAdminClient).mockResolvedValue({ from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(mockSelect) }) } as never);

    const res = await GET(makeRequest("bad-session") as never);
    expect(res.status).toBe(404);
  });

  test("returns a valid XLSX with correct column headers", async () => {
    const { validateEnrollwareKey } = await import("@/lib/enrollware-api-auth");
    vi.mocked(validateEnrollwareKey).mockResolvedValue({ ok: true, profileId: "profile-1" } as never);

    const { createAdminClient } = await import("@/lib/supabase/server");
    const mockSession = {
      id: "session-1",
      roster_records: [
        {
          first_name: "Alice", last_name: "Smith", email: "alice@example.com",
          phone: "555-1234", address_1: "123 Main St", address_2: null,
          city: "Portland", state: "OR", zip: "97201",
          grade: 100, ccf_compression: 80, confirmed: true, bookings: null,
        },
      ],
    };
    const mockSelect = {
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    };
    vi.mocked(createAdminClient).mockResolvedValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(mockSelect) }),
    } as never);

    const res = await GET(makeRequest("session-1") as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet");

    const workbook = await parseResponseAsWorkbook(res);
    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0].name).toBe("Students");

    const sheet = workbook.worksheets[0];
    const headerRow = sheet.getRow(1).values as (string | undefined)[];
    // ExcelJS row values are 1-indexed; index 0 is undefined
    const headers = headerRow.slice(1);
    expect(headers).toContain("Last Name");
    expect(headers).toContain("First Name");
    expect(headers).toContain("Email Address");
    expect(headers).toContain("Score");
    expect(headers).toContain("Status");
    expect(headers).toContain("CCF Compression");
  });

  test("maps student data to correct columns", async () => {
    const { validateEnrollwareKey } = await import("@/lib/enrollware-api-auth");
    vi.mocked(validateEnrollwareKey).mockResolvedValue({ ok: true, profileId: "profile-1" } as never);

    const { createAdminClient } = await import("@/lib/supabase/server");
    const mockSession = {
      id: "session-1",
      roster_records: [
        {
          first_name: "Bob", last_name: "Jones", email: "bob@example.com",
          phone: "555-9999", address_1: "456 Oak Ave", address_2: null,
          city: "Salem", state: "OR", zip: "97301",
          grade: 95, ccf_compression: 75, confirmed: true, bookings: null,
        },
        {
          first_name: "Carol", last_name: "Lee", email: "carol@example.com",
          phone: null, address_1: null, address_2: null,
          city: null, state: null, zip: null,
          grade: null, ccf_compression: null, confirmed: false, bookings: null,
        },
      ],
    };
    const mockSelect = {
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    };
    vi.mocked(createAdminClient).mockResolvedValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(mockSelect) }),
    } as never);

    const res = await GET(makeRequest("session-1") as never);
    const workbook = await parseResponseAsWorkbook(res);
    const sheet = workbook.worksheets[0];

    // Row 2 = first student (row 1 is headers)
    const row2 = sheet.getRow(2).values as unknown[];
    // Columns (1-indexed): Last Name, First Name, Email, Phone, Addr1, Addr2,
    //   City, State, Zip, Score, Status, License, Price, Codes, CCF Compression
    expect(row2[1]).toBe("Jones");     // Last Name
    expect(row2[2]).toBe("Bob");       // First Name
    expect(row2[3]).toBe("bob@example.com"); // Email
    expect(row2[11]).toBe("Complete"); // Status (col 11) — confirmed

    // Row 3 = second student (unconfirmed, nulls)
    const row3 = sheet.getRow(3).values as unknown[];
    expect(row3[1]).toBe("Lee");
    expect(row3[11]).toBe("No Show"); // Status (col 11) — not confirmed
  });
});
