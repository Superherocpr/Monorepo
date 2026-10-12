/**
 * Static guards for the admin-only dark theme.
 *
 * WHY THIS FILE EXISTS
 *   Dark mode used to be a global toggle: a script in the ROOT layout added a
 *   `dark` class to <html>, so one staff member's preference darkened public
 *   pages, including the customer rollcall page, on that device. The theme is
 *   now confined to the `.admin-theme` wrapper. These tests make the old leak
 *   structurally impossible to reintroduce without a test failing, and keep the
 *   hand-maintained CSS internally consistent.
 *
 * Static guard: proves the wiring, not the pixels. Pixel-level proof that
 * rollcall stays light lives in tests/e2e/admin-theme.spec.ts.
 */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, "app/(admin)/admin-theme.css"), "utf8");

/** Recursively lists .ts/.tsx source files under a directory (relative to apps/web). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const APP_SOURCE = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")];

describe("dark mode cannot reach the public site", () => {
  test("no source file toggles a dark class on the document", () => {
    const offenders = APP_SOURCE.filter((file) => {
      const text = readFileSync(join(ROOT, file), "utf8");
      return /classList\.(add|toggle)\(\s*["']dark["']/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test("the root layout carries no theme script or theme state", () => {
    const root = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
    expect(root).not.toMatch(/localStorage/);
    expect(root).not.toMatch(/dangerouslySetInnerHTML/);
    expect(root).not.toMatch(/data-admin-theme/);
  });

  test("the admin theme attribute is set only by AdminThemeScope and its init script", () => {
    const users = APP_SOURCE.filter((file) =>
      readFileSync(join(ROOT, file), "utf8").includes("data-admin-theme")
    );
    expect(users).toEqual([
      "app/(admin)/_components/AdminThemeScope.tsx",
      "lib/admin-theme.ts",
    ]);
  });

  test("admin-theme.css is imported only by the admin layout", () => {
    const importers = APP_SOURCE.filter((file) =>
      /import\s+["'][^"']*admin-theme\.css["']/.test(readFileSync(join(ROOT, file), "utf8"))
    );
    expect(importers).toEqual(["app/(admin)/layout.tsx"]);
  });

  test("every rule in admin-theme.css is scoped to the admin wrapper or a tour popover", () => {
    // Strip comments, then check each top-level selector list.
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...stripped.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim());
    const unscoped = rules.filter(
      (selector) =>
        !/^\.admin-theme\b/.test(selector) &&
        !/^html:has\(\.admin-theme\[data-admin-theme="dark"\]\)/.test(selector) &&
        !/^body:has\(\.admin-theme\[data-admin-theme="dark"\]\)/.test(selector) &&
        !/^\.driver-popover\.admin-tour-dark/.test(selector) &&
        !/^\.admin-tour-dark\b/.test(selector) &&
        selector !== ":root"
    );
    expect(unscoped).toEqual([]);
  });

  test(":root in admin-theme.css only declares the admin-prefixed page variable", () => {
    const root = CSS.match(/:root\s*\{([^}]*)\}/);
    expect(root).not.toBeNull();
    const declared = [...(root?.[1] ?? "").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    expect(declared).toEqual(["--admin-page"]);
  });
});

describe("no dark: utility classes", () => {
  // Theming is done by admin-theme.css remapping the palette. A dark: class would
  // double-apply on top of it inside the admin, and is dead weight everywhere else.
  test("source contains no dark: variants", () => {
    const offenders: string[] = [];
    for (const file of APP_SOURCE) {
      readFileSync(join(ROOT, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/(^|[\s"'`])dark:[a-z[]/.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("admin-theme.css internal consistency", () => {
  /** Extracts the --color-* custom properties declared in the block starting at `selector`. */
  function colorVarsIn(selector: string): string[] {
    const start = CSS.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const body = CSS.slice(start, CSS.indexOf("}", start));
    return [...body.matchAll(/(--color-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  }

  test("the light island restores every palette variable the dark scope overrides", () => {
    const dark = colorVarsIn('.admin-theme[data-admin-theme="dark"]');
    const island = colorVarsIn('.admin-theme[data-admin-theme="dark"] .admin-light-island');
    expect(dark.length).toBeGreaterThan(40);
    expect([...island].sort()).toEqual([...dark].sort());
  });

  test("the wrapper and the light island both set a default text color", () => {
    // Form controls inherit color, and ~225 admin fields set none. Without a default
    // on the wrapper they render the body's near-black on dark (Contact reply boxes).
    const block = (selector: string): string => {
      const start = CSS.indexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      return CSS.slice(start, CSS.indexOf("}", start));
    };
    expect(block(".admin-theme")).toMatch(/\bcolor:\s*var\(--color-gray-900\)/);
    expect(
      block('.admin-theme[data-admin-theme="dark"] .admin-light-island')
    ).toMatch(/\bcolor:\s*var\(--color-gray-900\)/);
  });

  test("colored text classes used in the admin each have a dark-mode rule", () => {
    // Shades 500-900 double as solid button fills, so their variables are NOT
    // remapped; only text-* utilities are overridden by attribute selectors. A
    // text-<hue>-<shade> class missing from the CSS would render dark-on-dark.
    // Plain text-<hue>-400 is already light enough on dark, so only 500+ needs a rule;
    // interactive variants (hover:, group-hover:, file:) get one from 400 up.
    const hues = "(?:red|green|amber|blue|purple|indigo|yellow|orange|teal|sky)";
    const pattern = new RegExp(
      `\\b((?:(?:hover:|group-hover:|file:)text-${hues}-[4-9]00)|(?:text-${hues}-[5-9]00))\\b`,
      "g"
    );
    const missing = new Set<string>();
    for (const file of sourceFiles("app/(admin)")) {
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const match of text.matchAll(pattern)) {
        if (!CSS.includes(`[class~="${match[1]}"]`)) missing.add(match[1]);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
