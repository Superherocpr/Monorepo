/**
 * Unit tests for PATCH /api/customers/[id]/update-profile
 * (app/api/customers/[id]/update-profile/route.ts)
 *
 * Properties under test:
 *   - name, phone and email can never be blanked (phone is required site-wide);
 *   - optional fields can be cleared;
 *   - when the login email cannot be changed, the profile goes back to the
 *     PREVIOUS address, not the rejected one.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server     — admin client recording every profiles update
 *   @/lib/auth/effective-role — role resolution
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/customers/[id]/update-profile/route";

const CUSTOMER_ID = "44444444-4444-4444-4444-444444444444";

/** Payloads passed to profiles.update(), in call order. */
const profileUpdates: Array<Record<string, unknown>> = [];
const updateUserById = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { email: "old@example.com" } }) }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        profileUpdates.push(payload);
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      },
    }),
    auth: { admin: { updateUserById } },
  })),
}));

vi.mock("@/lib/auth/effective-role", () => ({
  requireApiRole: vi.fn(async () => ({ actor: { user: { id: "manager-1" } } })),
}));

/**
 * Calls the route as a manager editing one field of CUSTOMER_ID.
 * @param field - profile column to change
 * @param value - the new value as typed
 */
async function patch(field: string, value: string): Promise<Response> {
  const request = new Request("http://test/api/customers/x/update-profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field, value }),
  });
  return PATCH(request, { params: Promise.resolve({ id: CUSTOMER_ID }) });
}

describe("PATCH /api/customers/[id]/update-profile", () => {
  beforeEach(() => {
    profileUpdates.length = 0;
    updateUserById.mockReset();
    updateUserById.mockResolvedValue({ error: null });
  });

  test("saves a trimmed last name", async () => {
    const res = await patch("last_name", "  Smith ");
    expect(res.status).toBe(200);
    expect(profileUpdates[0]).toMatchObject({ last_name: "Smith" });
  });

  test.each([
    ["first_name", "First name is required."],
    ["last_name", "Last name is required."],
    ["phone", "Phone number is required."],
    ["email", "Email is required."],
  ])("refuses a blank %s", async (field, message) => {
    const res = await patch(field, "   ");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(message);
    expect(profileUpdates).toEqual([]);
  });

  test("allows clearing an optional field", async () => {
    const res = await patch("address", "");
    expect(res.status).toBe(200);
    expect(profileUpdates[0]).toMatchObject({ address: null });
  });

  test("rejects a field that is not editable", async () => {
    const res = await patch("role", "super_admin");
    expect(res.status).toBe(400);
    expect(profileUpdates).toEqual([]);
  });

  test("changes the login email along with the profile", async () => {
    const res = await patch("email", "new@example.com");
    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(CUSTOMER_ID, {
      email: "new@example.com",
      email_confirm: true,
    });
  });

  test("restores the previous email when the login email is refused", async () => {
    updateUserById.mockResolvedValue({ error: { message: "email_exists" } });
    const res = await patch("email", "taken@example.com");
    expect(res.status).toBe(409);
    expect(profileUpdates.map((u) => u.email)).toEqual(["taken@example.com", "old@example.com"]);
  });
});
