/**
 * Unit tests for lib/enrollware-bookmarklet.ts
 *
 * Covers: getBookmarkletSource — verifies structural integrity and
 * correct embedding of the apiBase URL into the generated script.
 */
import { describe, test, expect } from "vitest";
import { getBookmarkletSource } from "@/lib/enrollware-bookmarklet";

describe("getBookmarkletSource", () => {
  const SOURCE = getBookmarkletSource("https://superherocpr.com");

  test("returns a non-empty string", () => {
    expect(typeof SOURCE).toBe("string");
    expect(SOURCE.trim().length).toBeGreaterThan(0);
  });

  test("embeds the API base URL in the script", () => {
    // JSON.stringify wraps the URL in quotes inside the var declaration
    expect(SOURCE).toContain('"https://superherocpr.com"');
  });

  test("contains an IIFE wrapper", () => {
    expect(SOURCE).toMatch(/\(function\s*\(\)/);
  });

  test("includes the double-run guard", () => {
    // Prevents the bookmarklet from running twice if tapped quickly
    expect(SOURCE).toContain("__SCPR_LOADED");
  });

  test("includes the page-mode detection function", () => {
    expect(SOURCE).toContain("getPageMode");
  });

  test("includes the fetchTodaysClasses function", () => {
    expect(SOURCE).toContain("fetchTodaysClasses");
  });

  test("uses different API base URLs for different environments", () => {
    const staging = getBookmarkletSource("https://staging.superherocpr.com");
    const prod = getBookmarkletSource("https://superherocpr.com");
    expect(staging).toContain('"https://staging.superherocpr.com"');
    expect(prod).not.toContain('"https://staging.superherocpr.com"');
  });

  test("does not include the API key in the generated source", () => {
    // The key is injected at runtime by the bookmark wrapper — never baked in
    expect(SOURCE).not.toContain("FACEBOOK");
    expect(SOURCE).not.toContain("SERVICE_ROLE");
    expect(SOURCE).not.toContain("supabase");
  });
});
