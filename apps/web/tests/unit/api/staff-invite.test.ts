/**
 * Unit tests for POST /api/staff/invite (app/api/staff/invite/route.ts)
 *
 * The property under test is a project rule, not a type: **phone is required on
 * every account in this system.** Staff invites were the one flow that never
 * collected one, so instructors were created with `phone = null` — and because
 * the booking confirmation email prints the instructor's number to the customer,
 * those accounts produced "Need to reschedule? Call us at null." in production.
 *
 * TypeScript cannot catch this: the body arrives as JSON and is cast, so a
 * missing field is only ever a runtime concern. Hence a test.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server     — prevents the Next.js cookies() runtime requirement
 *   @/lib/auth/effective-role — session auth resolution
 *   @/lib/send-email          — prevents real email sends
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/staff/invite/route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/effective-role", () => ({
  requireApiRole: vi.fn(),
}));

const sendEmailMock = vi.fn().mockResolvedValue({ sent: true, id: "email-1" });
vi.mock("@/lib/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  sendEmails: vi.fn(),
  isEmailConfigured: () => true,
}));

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

const NEW_USER_ID = "44444444-4444-4444-4444-444444444444";

/** Valid invite body; individual tests omit or blank one field. */
function body(over: Record<string, unknown> = {}) {
  return {
    firstName: "Jane",
    lastName: "Smith",
    email: "jane@example.com",
    phone: "(813) 555-0147",
    role: "instructor",
    ...over,
  };
}

function makeRequest(payload: Record<string, unknown>): Request {
  return new Request("https://superherocpr.com/api/staff/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Captures the row passed to profiles.insert so the test can assert on it. */
let insertedProfile: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  insertedProfile = null;

  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: { user: { id: "admin-1" }, profile: {}, effectiveRole: "super_admin" },
  });

  // Duplicate-email lookup resolves to "no existing account".
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    }),
  });

  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: NEW_USER_ID } }, error: null }),
        deleteUser: vi.fn().mockResolvedValue({}),
        generateLink: vi
          .fn()
          .mockResolvedValue({ data: { properties: { hashed_token: "tok" } }, error: null }),
      },
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insertedProfile = row;
        return Promise.resolve({ error: null });
      },
    }),
  });
});

describe("POST /api/staff/invite — phone is required", () => {
  test("rejects an invite with no phone field at all", async () => {
    const payload = body();
    delete (payload as Record<string, unknown>).phone;

    const res = await POST(makeRequest(payload));

    expect(res.status).toBe(400);
    // No account may be created — a staff row without a phone is the defect.
    expect(insertedProfile).toBeNull();
  });

  test("rejects an invite with a blank phone", async () => {
    const res = await POST(makeRequest(body({ phone: "   " })));

    expect(res.status).toBe(400);
    expect(insertedProfile).toBeNull();
  });

  test("stores the trimmed phone on the profile when one is supplied", async () => {
    const res = await POST(makeRequest(body({ phone: "  (813) 555-0147  " })));

    expect(res.status).toBe(200);
    expect(insertedProfile).not.toBeNull();
    expect(insertedProfile).toMatchObject({
      phone: "(813) 555-0147",
      first_name: "Jane",
      role: "instructor",
    });
  });

  test("still enforces the other required fields", async () => {
    for (const missing of ["firstName", "lastName", "email"]) {
      const res = await POST(makeRequest(body({ [missing]: "" })));
      expect(res.status).toBe(400);
    }
  });

  test("still blocks super_admin from being assigned by invite", async () => {
    const res = await POST(makeRequest(body({ role: "super_admin" })));

    expect(res.status).toBe(400);
    expect(insertedProfile).toBeNull();
  });
});
