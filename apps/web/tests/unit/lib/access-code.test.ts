/**
 * Unit tests for lib/access-code.ts
 *
 * Covers: generateAccessCode format, and assignFreshAccessCode's success,
 * collision-retry, non-collision-error, and give-up-after-max-attempts paths.
 * The Supabase client is mocked — only the update().eq() chain the helper
 * uses is stubbed.
 */
import { describe, test, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateAccessCode, assignFreshAccessCode } from "@/lib/access-code";

/**
 * Builds a mock SupabaseClient whose profiles.update().eq() resolves with the
 * given error results in order (null = success). Records how many update
 * attempts were made.
 */
function mockClient(errorSequence: Array<{ code?: string; message: string } | null>) {
  let call = 0;
  const eq = vi.fn().mockImplementation(() => {
    const error = errorSequence[Math.min(call, errorSequence.length - 1)];
    call += 1;
    return Promise.resolve({ error });
  });
  const client = {
    from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) }),
  } as unknown as SupabaseClient;
  return { client, attempts: () => call };
}

describe("generateAccessCode", () => {
  test("always returns exactly 6 digits, zero-padded", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateAccessCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe("assignFreshAccessCode", () => {
  test("returns the code and timestamp on first-try success", async () => {
    const { client, attempts } = mockClient([null]);
    const result = await assignFreshAccessCode(client, "user-1");
    expect(result.error).toBeNull();
    expect(result.data?.code).toMatch(/^\d{6}$/);
    expect(Date.parse(result.data!.generatedAt)).not.toBeNaN();
    expect(attempts()).toBe(1);
  });

  test("retries on unique-violation (23505) and succeeds", async () => {
    const { client, attempts } = mockClient([
      { code: "23505", message: "duplicate key value" },
      { code: "23505", message: "duplicate key value" },
      null,
    ]);
    const result = await assignFreshAccessCode(client, "user-1");
    expect(result.error).toBeNull();
    expect(result.data?.code).toMatch(/^\d{6}$/);
    expect(attempts()).toBe(3);
  });

  test("returns the error immediately on a non-collision failure", async () => {
    const { client, attempts } = mockClient([
      { code: "42501", message: "permission denied" },
    ]);
    const result = await assignFreshAccessCode(client, "user-1");
    expect(result.data).toBeNull();
    expect(result.error).toBe("permission denied");
    expect(attempts()).toBe(1);
  });

  test("gives up after max attempts of persistent collisions", async () => {
    const { client, attempts } = mockClient([
      { code: "23505", message: "duplicate key value" },
    ]);
    const result = await assignFreshAccessCode(client, "user-1");
    expect(result.data).toBeNull();
    expect(result.error).toContain("5 attempts");
    expect(attempts()).toBe(5);
  });
});
