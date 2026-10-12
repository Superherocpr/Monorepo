/**
 * Unit tests for lib/admin-theme.ts: preference parsing, resolution, and the
 * inline flash-prevention script (executed against stubbed browser globals so
 * it cannot drift from the helpers it mirrors).
 */
import { describe, it, expect } from "vitest";
import {
  ADMIN_THEME_INIT_SCRIPT,
  ADMIN_THEME_STORAGE_KEY,
  parseAdminThemePreference,
  resolveAdminTheme,
  type AdminThemePreference,
} from "@/lib/admin-theme";

describe("parseAdminThemePreference", () => {
  it("accepts the three valid values", () => {
    expect(parseAdminThemePreference("light")).toBe("light");
    expect(parseAdminThemePreference("dark")).toBe("dark");
    expect(parseAdminThemePreference("system")).toBe("system");
  });

  it("falls back to light for missing or unrecognised values (dark is opt-in)", () => {
    expect(parseAdminThemePreference(null)).toBe("light");
    expect(parseAdminThemePreference(undefined)).toBe("light");
    expect(parseAdminThemePreference("")).toBe("light");
    expect(parseAdminThemePreference("DARK")).toBe("light");
    expect(parseAdminThemePreference("<script>")).toBe("light");
  });
});

describe("resolveAdminTheme", () => {
  it("returns explicit choices regardless of the OS setting", () => {
    expect(resolveAdminTheme("light", true)).toBe("light");
    expect(resolveAdminTheme("dark", false)).toBe("dark");
  });

  it("follows the OS only for the system preference", () => {
    expect(resolveAdminTheme("system", true)).toBe("dark");
    expect(resolveAdminTheme("system", false)).toBe("light");
  });
});

/**
 * Runs the inline script against fake globals and returns the attribute it set.
 * @param stored - Value of localStorage["admin-theme"], or null for absent.
 * @param systemDark - What the stubbed prefers-color-scheme query reports.
 * @param storageThrows - Simulates localStorage being blocked.
 */
function runInitScript(
  stored: string | null,
  systemDark: boolean,
  storageThrows = false
): string | null {
  let attribute: string | null = null;
  const stubDocument = {
    currentScript: {
      parentElement: {
        setAttribute: (name: string, value: string): void => {
          if (name === "data-admin-theme") attribute = value;
        },
      },
    },
  };
  const stubLocalStorage = {
    getItem: (key: string): string | null => {
      if (storageThrows) throw new Error("blocked");
      return key === ADMIN_THEME_STORAGE_KEY ? stored : null;
    },
  };
  const stubWindow = {
    matchMedia: () => ({ matches: systemDark }),
  };
  new Function("document", "localStorage", "window", ADMIN_THEME_INIT_SCRIPT)(
    stubDocument,
    stubLocalStorage,
    stubWindow
  );
  return attribute;
}

describe("ADMIN_THEME_INIT_SCRIPT", () => {
  it("agrees with parse + resolve for every stored value and OS setting", () => {
    const stored: (string | null)[] = [null, "light", "dark", "system", "junk"];
    for (const value of stored) {
      for (const systemDark of [true, false]) {
        const preference: AdminThemePreference = parseAdminThemePreference(value);
        expect(runInitScript(value, systemDark)).toBe(
          resolveAdminTheme(preference, systemDark)
        );
      }
    }
  });

  it("leaves the wrapper untouched (light by default) when storage is blocked", () => {
    expect(runInitScript("dark", true, true)).toBeNull();
  });

  it("does not use the legacy global 'theme' key", () => {
    expect(ADMIN_THEME_STORAGE_KEY).not.toBe("theme");
  });
});
