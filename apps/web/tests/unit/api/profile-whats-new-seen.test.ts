/**
 * Unit tests for POST /api/profile/whats-new-seen.
 *
 * The route records that a staff member has read the changelog. What matters:
 * it refuses anyone who is not staff, it always writes the server's own newest
 * version (never anything from the request), and it writes only the caller's
 * own profile row.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { POST } from "@/app/api/profile/whats-new-seen/route";
import { CHANGELOG } from "@/content/changelog";
import { latestVersion } from "@/lib/changelog";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/effective-role", () => ({
  requireApiRole: vi.fn(),
  STAFF_ROLES: ["instructor", "manager", "super_admin", "inspector"],
}));

import { createClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

const updateMock = vi.fn();
const eqMock = vi.fn();

function stubSupabase(error: unknown = null): void {
  eqMock.mockResolvedValue({ error });
  updateMock.mockReturnValue({ eq: eqMock });
  vi.mocked(createClient).mockResolvedValue({
    from: () => ({ update: updateMock }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/profile/whats-new-seen", () => {
  test("rejects a caller who is not signed in as staff", async () => {
    vi.mocked(requireApiRole).mockResolvedValue({
      error: NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST();
    expect(res.status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("writes the newest changelog version to the caller's own profile", async () => {
    vi.mocked(requireApiRole).mockResolvedValue({
      actor: { user: { id: "user-1" } },
    } as never);
    stubSupabase();

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ data: { version: latestVersion(CHANGELOG) }, error: null });
    expect(updateMock).toHaveBeenCalledWith({ whats_new_seen_version: latestVersion(CHANGELOG) });
    expect(eqMock).toHaveBeenCalledWith("id", "user-1");
  });

  test("returns a generic error when the write fails, without leaking details", async () => {
    vi.mocked(requireApiRole).mockResolvedValue({
      actor: { user: { id: "user-1" } },
    } as never);
    stubSupabase({ message: 'column "whats_new_seen_version" does not exist' });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ data: null, error: "Failed to save." });
  });
});
