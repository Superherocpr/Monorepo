/**
 * Unit tests for POST /api/social/refresh (app/api/social/refresh/route.ts)
 *
 * Tests authorization gating (cron secret and super_admin session),
 * successful upsert path, empty-feed edge case, and DB error handling.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server — prevents Next.js cookies() runtime requirement
 *   @/lib/facebook        — prevents real Graph API calls
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/social/refresh/route";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/facebook", () => ({
  fetchFacebookPhotoPosts: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fetchFacebookPhotoPosts } from "@/lib/facebook";

const CRON_SECRET = "test-cron-secret-abc123";

/** Returns a Request with the cron Authorization header. */
function cronRequest(): Request {
  return new Request("https://superherocpr.com/api/social/refresh", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
}

/** Minimal Facebook post fixture. */
const FAKE_POSTS = [
  {
    facebook_post_id: "123_abc",
    photo_url: "https://scontent.fbcdn.net/photo.jpg",
    post_url: "https://www.facebook.com/123/posts/abc",
    caption: "Great class today!",
    posted_at: "2026-05-30T14:00:00Z",
  },
];

/** Sets up the admin Supabase client mock to succeed for upsert and delete. */
function mockAdminSuccess() {
  const mockDeleteChain = { like: vi.fn().mockResolvedValue({ error: null }) };
  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === "social_feed_cache") {
      return {
        upsert: vi.fn().mockResolvedValue({ error: null }),
        delete: vi.fn().mockReturnValue(mockDeleteChain),
      };
    }
    return {};
  });
  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from: mockFrom });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/social/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    (fetchFacebookPhotoPosts as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_POSTS);
    mockAdminSuccess();
  });

  test("returns 401 when no Authorization header is provided and no session", async () => {
    // createClient returns a user of null (not authenticated)
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
    });
    const req = new Request("https://superherocpr.com/api/social/refresh", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  test("returns 401 when the cron secret does not match", async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
    });
    const req = new Request("https://superherocpr.com/api/social/refresh", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 200 with upserted count when authorized via cron secret", async () => {
    const res = await POST(cronRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.upserted).toBe(FAKE_POSTS.length);
  });

  test("returns 200 and allows a super_admin session to refresh", async () => {
    // No CRON_SECRET header — should fall through to session check
    delete process.env.CRON_SECRET;
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { role: "super_admin" } }),
          }),
        }),
      }),
    });
    const req = new Request("https://superherocpr.com/api/social/refresh", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  test("returns 200 with message when Facebook returns no photo posts", async () => {
    (fetchFacebookPhotoPosts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const res = await POST(cronRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.upserted).toBe(0);
    expect(json.message).toBeDefined();
  });

  test("returns 500 when the DB upsert fails", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: { message: "DB error" } }),
      delete: vi.fn(),
    });
    (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from: mockFrom });
    const res = await POST(cronRequest());
    expect(res.status).toBe(500);
  });
});
