/**
 * Source-scan guard: keeps personal data from becoming readable by the public
 * API key again.
 *
 * Background (2026-10-28 security review): `profiles` and `roster_records` hold
 * every customer's and staff member's contact details. Two RLS policies, plus a
 * browser-side email lookup that depended on them, let anyone holding the
 * site's public API key read every row and every column. RLS filters rows, not
 * columns, so there is no safe way to expose "just the email check". The fix
 * moved those reads server-side (migration 0080).
 *
 * This scan fails the build if the two ways back in reappear:
 *   1. Browser code (anything importing lib/supabase/client) querying profiles
 *      by someone else's email or phone, or touching roster_records at all.
 *      Own-row reads (.eq("id", ...)) and signup inserts are fine.
 *   2. A migration after 0080 creating a policy that lets anon/public read
 *      profiles or roster_records.
 *
 * The live database has the matching safeguard: health check #17
 * (public_read_policy_on_pii_table) reports any such policy nightly.
 */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const WEB_ROOT = process.cwd();
const MIGRATIONS_DIR = join(WEB_ROOT, "..", "migrations");

/** Recursively lists .ts/.tsx source files, skipping dependencies and build output. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", "tests", "test-results", "playwright-report"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Matches a `create policy ... on profiles|roster_records ... to ... anon|public` statement. */
const OPEN_PII_POLICY =
  /create\s+policy[^;]*?\bon\s+(?:public\.)?(?:profiles|roster_records)\b[^;]*?\bto\b[^;]*?\b(?:anon|public)\b/i;

describe("browser code cannot read other people's personal data", () => {
  const browserFiles = [
    ...sourceFiles(join(WEB_ROOT, "app")),
    ...sourceFiles(join(WEB_ROOT, "components")),
    ...sourceFiles(join(WEB_ROOT, "lib")),
  ].filter((f) => /from\s+["']@\/lib\/supabase\/client["']/.test(readFileSync(f, "utf8")));

  test("finds the browser-client files it is meant to police", () => {
    // Guards against the scan silently matching nothing if the import path changes.
    expect(browserFiles.length).toBeGreaterThanOrEqual(5);
  });

  test("none of them filters profiles by email or phone", () => {
    const offenders = browserFiles.filter((f) => /\.eq\(\s*["'](?:email|phone)["']/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(WEB_ROOT, f))).toEqual([]);
  });

  test("none of them touches roster_records", () => {
    const offenders = browserFiles.filter((f) => /["']roster_records["']/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(WEB_ROOT, f))).toEqual([]);
  });
});

describe("migrations cannot reopen public reads of personal data", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f));

  test("the pattern really detects the original leaky policies (not a vacuous check)", () => {
    const original = readFileSync(join(MIGRATIONS_DIR, "0023_enable_rls.sql"), "utf8");
    expect(OPEN_PII_POLICY.test(original)).toBe(true);
  });

  test("no migration after 0080 creates an anon/public policy on profiles or roster_records", () => {
    const later = files.filter((f) => Number(f.slice(0, 4)) > 80);
    const offenders = later.filter((f) => OPEN_PII_POLICY.test(readFileSync(join(MIGRATIONS_DIR, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  test("0080 itself only drops those policies, never creates one", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0080_revoke_anon_pii_reads.sql"), "utf8");
    const withoutComments = sql.replace(/--.*$/gm, "");
    expect(OPEN_PII_POLICY.test(withoutComments)).toBe(false);
    for (const name of [
      "profiles_anon_email_exists_check",
      "profiles_anon_read_lead_instructor",
      "roster_records_anon_read_by_session",
    ]) {
      expect(withoutComments).toContain(`drop policy if exists "${name}"`);
    }
  });
});
