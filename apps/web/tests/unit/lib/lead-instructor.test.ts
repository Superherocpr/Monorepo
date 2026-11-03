/**
 * Unit tests for lib/lead-instructor.ts.
 *
 * The helper feeds the home page and blog byline. What matters: it asks the
 * database for exactly the two name columns (never the whole profile row, which
 * holds phone, address and payout details), only for an active lead
 * instructor, and degrades to null instead of throwing when there is nothing
 * to show.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { getLeadInstructorName } from "@/lib/lead-instructor";

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/server";

const selectMock = vi.fn();
const eqMock = vi.fn();
const maybeSingleMock = vi.fn();

function stubAdmin(result: { data: unknown; error: unknown }): void {
  maybeSingleMock.mockResolvedValue(result);
  const chain = { select: selectMock, eq: eqMock, maybeSingle: maybeSingleMock };
  selectMock.mockReturnValue(chain);
  eqMock.mockReturnValue(chain);
  vi.mocked(createAdminClient).mockResolvedValue({ from: () => chain } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getLeadInstructorName", () => {
  test("returns 'First Last' for the active lead instructor", async () => {
    stubAdmin({ data: { first_name: "Alex", last_name: "Hero" }, error: null });
    expect(await getLeadInstructorName()).toBe("Alex Hero");
  });

  test("selects only the two name columns, for an active lead instructor", async () => {
    stubAdmin({ data: { first_name: "Alex", last_name: "Hero" }, error: null });
    await getLeadInstructorName();
    expect(selectMock).toHaveBeenCalledWith("first_name, last_name");
    expect(eqMock).toHaveBeenCalledWith("is_lead_instructor", true);
    expect(eqMock).toHaveBeenCalledWith("deactivated", false);
  });

  test("returns null when no lead instructor exists", async () => {
    stubAdmin({ data: null, error: null });
    expect(await getLeadInstructorName()).toBeNull();
  });

  test("returns null, and does not throw, when the lookup fails", async () => {
    stubAdmin({ data: null, error: { message: "boom" } });
    expect(await getLeadInstructorName()).toBeNull();
  });
});
