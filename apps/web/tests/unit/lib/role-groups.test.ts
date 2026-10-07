/**
 * Unit tests for the teaching-role group in lib/auth/view-as-constants.ts, plus
 * a source scan that keeps managers from being silently left out of instructor
 * features again.
 *
 * Background: managers teach classes too, and must get every instructor
 * capability on top of their own. Before TEACHING_ROLES existed, instructor
 * features were gated on hand-written ["instructor", "super_admin"] arrays, and
 * every new feature quietly excluded managers (grading, CCF, payouts, rollcall
 * code verification...). The scan below fails the build if that pattern returns.
 */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import {
  TEACHING_ROLES,
  isTeachingRole,
  canUseInstructorToolsOn,
} from "@/lib/auth/view-as-constants";

const ME = "11111111-1111-1111-1111-111111111111";
const SOMEONE_ELSE = "22222222-2222-2222-2222-222222222222";

describe("TEACHING_ROLES / isTeachingRole", () => {
  test("covers instructor, manager, and super_admin", () => {
    expect([...TEACHING_ROLES].sort()).toEqual(["instructor", "manager", "super_admin"]);
  });

  test("managers are a teaching role", () => {
    expect(isTeachingRole("manager")).toBe(true);
  });

  test("inspectors and customers are not", () => {
    expect(isTeachingRole("inspector")).toBe(false);
    expect(isTeachingRole("customer")).toBe(false);
  });
});

describe("canUseInstructorToolsOn", () => {
  test("a manager may use instructor tools on their own class", () => {
    expect(canUseInstructorToolsOn("manager", ME, ME)).toBe(true);
  });

  test("a manager may NOT grade or invoice another instructor's class", () => {
    expect(canUseInstructorToolsOn("manager", ME, SOMEONE_ELSE)).toBe(false);
  });

  test("an instructor is limited to their own class", () => {
    expect(canUseInstructorToolsOn("instructor", ME, ME)).toBe(true);
    expect(canUseInstructorToolsOn("instructor", ME, SOMEONE_ELSE)).toBe(false);
  });

  test("a super admin may act on any class, including unassigned ones", () => {
    expect(canUseInstructorToolsOn("super_admin", ME, SOMEONE_ELSE)).toBe(true);
    expect(canUseInstructorToolsOn("super_admin", ME, null)).toBe(true);
  });

  test("an unassigned class belongs to no teaching role below super admin", () => {
    expect(canUseInstructorToolsOn("manager", ME, null)).toBe(false);
    expect(canUseInstructorToolsOn("instructor", ME, undefined)).toBe(false);
  });

  test("inspectors never get instructor tools, even on a record bearing their id", () => {
    expect(canUseInstructorToolsOn("inspector", ME, ME)).toBe(false);
  });
});

// ── Source scan ──────────────────────────────────────────────────────────────

const WEB_ROOT = join(__dirname, "..", "..", "..");
const SCANNED_DIRS = ["app", "lib", "components"];

/** Recursively lists .ts/.tsx files under a directory. */
function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** True for a line that is only a comment (JSDoc body, // line, or block-comment start). */
function isCommentLine(line: string): boolean {
  return /^\s*(\*|\/\/|\/\*)/.test(line);
}

describe("instructor gates always include managers", () => {
  const offenders: string[] = [];

  for (const dir of SCANNED_DIRS) {
    for (const file of listSourceFiles(join(WEB_ROOT, dir))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (isCommentLine(line) || !line.includes('"instructor"')) return;
        const where = `${relative(WEB_ROOT, file)}:${i + 1}: ${line.trim()}`;

        // e.g. ["instructor", "super_admin"] or role === "instructor" || role === "super_admin":
        // a gate naming instructors and super admins but not managers.
        if (line.includes('"super_admin"') && !line.includes('"manager"')) {
          offenders.push(where);
          return;
        }

        // e.g. requireApiRole(["instructor"]) or roles: ["instructor"]: any one-line
        // array made only of string literals (a role list, not a type index like
        // Data["instructor"]) that admits instructors must admit managers too.
        const roleLists = line.match(/(?<![\w\]])\[\s*"[a-z_]+"(?:\s*,\s*"[a-z_]+")*\s*\]/g) ?? [];
        if (roleLists.some((arr) => arr.includes('"instructor"') && !arr.includes('"manager"'))) {
          offenders.push(where);
        }
      });
    }
  }

  // Deliberate exceptions:
  // - The instructor-only sidebar entry: an instructor's sessions list is already
  //   scoped to their own classes, while managers get their own "My Class
  //   Sessions" entry pointing at /admin/sessions?mine=1.
  // - The reference page's "instructorOnly" key, which marks restrictions that
  //   bind plain instructors only and so must stay hidden from managers.
  const ALLOWED = [
    'app/(admin)/_components/AdminSidebar.tsx: { label: "My Class Sessions", href: "/admin/sessions", roles: ["instructor"] },',
    'app/(admin)/admin/reference/_components/ReferenceContent.tsx: if (sectionRole === "instructorOnly") return userRole === "instructor" || userRole === "super_admin";',
  ];

  test("no role gate admits instructors while excluding managers", () => {
    const unexpected = offenders.filter(
      (o) => !ALLOWED.some((a) => o.replace(/:\d+:/, ":") === a)
    );
    // If this fails, use TEACHING_ROLES / isTeachingRole / canUseInstructorToolsOn
    // from lib/auth/view-as-constants.ts instead of a literal role list.
    expect(unexpected).toEqual([]);
  });

  test("the allowlist only names lines that still exist", () => {
    for (const a of ALLOWED) {
      expect(offenders.some((o) => o.replace(/:\d+:/, ":") === a)).toBe(true);
    }
  });
});
