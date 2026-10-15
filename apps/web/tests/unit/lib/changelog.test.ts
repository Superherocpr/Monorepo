/**
 * Unit tests for the staff "What's New" changelog: the pure logic in
 * lib/changelog.ts and the integrity of the real entries in content/changelog.ts.
 *
 * The integrity block is the health signal for the feature. It fails the suite
 * when someone bumps the app to a new minor or major version (CLAUDE.md rule 13)
 * without telling staff what changed, and when entries are malformed, out of
 * order, or reference roles that do not exist.
 */
import { describe, test, expect } from "vitest";
import {
  compareVersions,
  entriesForRole,
  entryKey,
  formatReleaseDate,
  groupByRelease,
  latestVersion,
  parseVersion,
  unreadEntries,
} from "@/lib/changelog";
import { CHANGELOG } from "@/content/changelog";
import { version as appVersion } from "../../../package.json";
import type { ChangelogEntry } from "@/types/changelog";
import type { UserRole } from "@/types/users";

function entry(overrides: Partial<ChangelogEntry>): ChangelogEntry {
  return {
    version: "1.0.0",
    date: "2026-01-01",
    kind: "new",
    title: "Thing",
    summary: "A thing.",
    ...overrides,
  };
}

describe("compareVersions", () => {
  test("orders numerically, not alphabetically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.9.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  test("equal versions compare as 0", () => {
    expect(compareVersions("1.4.1", "1.4.1")).toBe(0);
  });

  test("an unparseable version sorts as the oldest", () => {
    expect(compareVersions("garbage", "0.0.1")).toBeLessThan(0);
  });
});

describe("parseVersion", () => {
  test("accepts plain semver only", () => {
    expect(parseVersion("1.7.0")).toEqual([1, 7, 0]);
    expect(parseVersion("v1.7.0")).toBeNull();
    expect(parseVersion("1.7")).toBeNull();
    expect(parseVersion("1.7.0-beta")).toBeNull();
  });
});

describe("latestVersion", () => {
  test("returns the highest version regardless of list order", () => {
    const entries = [entry({ version: "1.2.0" }), entry({ version: "1.10.0" }), entry({ version: "1.9.0" })];
    expect(latestVersion(entries)).toBe("1.10.0");
  });

  test("is null for an empty changelog", () => {
    expect(latestVersion([])).toBeNull();
  });
});

describe("entriesForRole", () => {
  const everyone = entry({ title: "Everyone" });
  const managersOnly = entry({ title: "Managers", roles: ["manager", "super_admin"] });
  const superOnly = entry({ title: "Super", roles: ["super_admin"] });

  test("an entry with no roles is visible to every staff role", () => {
    for (const role of ["instructor", "manager", "super_admin", "inspector"] as UserRole[]) {
      expect(entriesForRole([everyone], role)).toHaveLength(1);
    }
  });

  test("a role-limited entry is hidden from other roles", () => {
    const all = [everyone, managersOnly, superOnly];
    expect(entriesForRole(all, "instructor").map((e) => e.title)).toEqual(["Everyone"]);
    expect(entriesForRole(all, "manager").map((e) => e.title)).toEqual(["Everyone", "Managers"]);
    expect(entriesForRole(all, "super_admin").map((e) => e.title)).toEqual([
      "Everyone",
      "Managers",
      "Super",
    ]);
  });
});

describe("groupByRelease", () => {
  test("groups by version, newest first, keeping entry order inside a release", () => {
    const releases = groupByRelease([
      entry({ version: "1.2.0", title: "a" }),
      entry({ version: "1.10.0", title: "b" }),
      entry({ version: "1.2.0", title: "c" }),
      entry({ version: "1.9.0", title: "d" }),
    ]);
    expect(releases.map((r) => r.version)).toEqual(["1.10.0", "1.9.0", "1.2.0"]);
    expect(releases[2].entries.map((e) => e.title)).toEqual(["a", "c"]);
  });
});

describe("unreadEntries", () => {
  const entries = [
    entry({ version: "1.7.0", date: "2026-10-15", title: "new one" }),
    entry({ version: "1.6.0", date: "2026-10-12", title: "middle" }),
    entry({ version: "1.5.0", date: "2026-10-10", title: "old" }),
  ];

  test("with a seen version, only newer versions are unread", () => {
    expect(unreadEntries(entries, "1.6.0", null).map((e) => e.title)).toEqual(["new one"]);
    expect(unreadEntries(entries, "1.7.0", null)).toEqual([]);
    expect(unreadEntries(entries, "1.4.0", null)).toHaveLength(3);
  });

  test("a seen version compares numerically, not as text", () => {
    const list = [entry({ version: "1.10.0" })];
    expect(unreadEntries(list, "1.9.0", null)).toHaveLength(1);
  });

  test("never opened: only entries released after the account existed are unread", () => {
    expect(unreadEntries(entries, null, "2026-10-11T08:00:00Z").map((e) => e.title)).toEqual([
      "new one",
      "middle",
    ]);
  });

  test("never opened and no created_at: nothing is flagged", () => {
    expect(unreadEntries(entries, null, null)).toEqual([]);
  });
});

describe("formatReleaseDate", () => {
  test("formats a calendar date without shifting it across time zones", () => {
    expect(formatReleaseDate("2026-10-15")).toBe("October 15, 2026");
    expect(formatReleaseDate("2026-01-01")).toBe("January 1, 2026");
  });
});

describe("the real changelog (content/changelog.ts)", () => {
  const VALID_ROLES: UserRole[] = ["instructor", "manager", "super_admin", "inspector"];

  test("is not empty", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
  });

  test("every entry has a valid version, date, kind and non-empty copy", () => {
    for (const e of CHANGELOG) {
      expect(parseVersion(e.version), `bad version on "${e.title}"`).not.toBeNull();
      expect(e.date, `bad date on "${e.title}"`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["new", "improved", "fixed"]).toContain(e.kind);
      expect(e.title.trim()).not.toBe("");
      expect(e.summary.trim()).not.toBe("");
    }
  });

  test("is ordered newest version first", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(
        compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version),
        `"${CHANGELOG[i].title}" is newer than the entry above it`
      ).toBeGreaterThanOrEqual(0);
    }
  });

  test("every entry of a version shares one release date", () => {
    const dateByVersion = new Map<string, string>();
    for (const e of CHANGELOG) {
      const seen = dateByVersion.get(e.version);
      if (seen) expect(e.date, `version ${e.version} has two dates`).toBe(seen);
      else dateByVersion.set(e.version, e.date);
    }
  });

  test("a newer version never has an earlier date", () => {
    const releases = groupByRelease(CHANGELOG);
    for (let i = 1; i < releases.length; i++) {
      expect(releases[i - 1].date >= releases[i].date).toBe(true);
    }
  });

  test("titles are unique within a version (they are half of the entry key)", () => {
    const keys = CHANGELOG.map(entryKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("role lists only name real staff roles", () => {
    for (const e of CHANGELOG) {
      for (const role of e.roles ?? []) expect(VALID_ROLES).toContain(role);
      if (e.roles) expect(e.roles.length).toBeGreaterThan(0);
    }
  });

  test("links point inside the admin area", () => {
    for (const e of CHANGELOG) {
      if (e.href) expect(e.href).toMatch(/^\/admin(\/|$)/);
    }
  });

  test("no em dashes in copy that staff read (CLAUDE.md rule 11)", () => {
    for (const e of CHANGELOG) {
      expect(`${e.title} ${e.summary}`).not.toContain("—");
    }
  });

  test("no entry is dated for a version the app has not reached", () => {
    const latest = latestVersion(CHANGELOG);
    expect(latest).not.toBeNull();
    expect(compareVersions(latest as string, appVersion)).toBeLessThanOrEqual(0);
  });

  test("a minor or major release in package.json has an entry (CLAUDE.md rule 14)", () => {
    const parsed = parseVersion(appVersion);
    expect(parsed).not.toBeNull();
    const [, , patch] = parsed as [number, number, number];
    // Patch releases are fixes and small tweaks and may have nothing worth announcing;
    // every x.y.0 is by definition a new feature or a visible change.
    if (patch === 0) {
      expect(
        CHANGELOG.some((e) => e.version === appVersion),
        `package.json is ${appVersion} but content/changelog.ts has no entry for it`
      ).toBe(true);
    }
  });
});
