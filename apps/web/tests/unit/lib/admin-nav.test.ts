/**
 * Unit tests for the admin sidebar grouping in lib/admin-nav.ts.
 *
 * Regression: section headers used to hang off one item each (Blog carried
 * "Engagement", Analytics carried "Management"), so a manager, who cannot see
 * those items, lost the headers and saw Contact, Directory and Settings under
 * "Financial". These tests pin the exact menu each role sees.
 */
import { describe, test, expect } from "vitest";
import { getVisibleNavItems, NAV_ITEMS, type NavItem } from "@/lib/admin-nav";
import type { UserRole } from "@/types/users";

/** Renders a role's menu as "SECTION: item, item" lines (items above any section listed first). */
function menuFor(role: UserRole): string[] {
  const lines: string[] = [];
  for (const item of getVisibleNavItems(role)) {
    if (item.sectionHeader || lines.length === 0) {
      lines.push(`${item.sectionHeader ? item.sectionHeader.toUpperCase() : "TOP"}: ${item.label}`);
    } else {
      lines[lines.length - 1] += `, ${item.label}`;
    }
  }
  return lines;
}

describe("sidebar menu per role", () => {
  test("manager", () => {
    expect(menuFor("manager")).toEqual([
      "TOP: Dashboard",
      "MY TEACHING: My Class Sessions, Rollcall, Payout Settings",
      "OPERATIONS: Class Sessions, Customers, Contact, Customer Requests, Instructor Requests",
      "FINANCIAL: Invoices, Payments",
      "TEAM: Directory, Settings",
    ]);
  });

  test("super admin", () => {
    expect(menuFor("super_admin")).toEqual([
      "TOP: Dashboard",
      "MY TEACHING: My Class Sessions, Rollcall, Payout Settings",
      "OPERATIONS: Class Sessions, Customers, Contact, Customer Requests, Instructor Requests",
      "FINANCIAL: Invoices, Payments, Payouts, Promo Codes",
      "ENGAGEMENT: Blog, Certifications, Merch, Orders",
      "MANAGEMENT: Analytics, Archived Accounts",
      "TEAM: Directory, Settings, Staff",
    ]);
  });

  test("instructor keeps the original menu: flat, with Payout Settings under Payroll", () => {
    expect(menuFor("instructor")).toEqual([
      "TOP: Dashboard, My Class Sessions, Rollcall, Directory, Settings",
      "PAYROLL: Payout Settings",
    ]);
  });

  test("inspector keeps the original flat menu", () => {
    expect(menuFor("inspector")).toEqual(["TOP: Dashboard, Directory"]);
  });
});

describe("section headers", () => {
  const roles: UserRole[] = ["instructor", "manager", "super_admin", "inspector"];

  test.each(roles)("%s: each section appears once and no section is split", (role) => {
    const headers = getVisibleNavItems(role)
      .map((i) => i.sectionHeader)
      .filter((h): h is string => h !== null);
    expect(new Set(headers).size).toBe(headers.length);
  });

  test("a header survives when the first item of its section is hidden from the role", () => {
    const items: NavItem[] = [
      { label: "Hidden first", href: "/a", roles: ["super_admin"], section: "Group" },
      { label: "Visible second", href: "/b", roles: ["manager"], section: "Group" },
    ];
    expect(getVisibleNavItems("manager", items).map((i) => i.sectionHeader)).toEqual(["Group"]);
  });

  test("every item a manager can reach under the old layout is still reachable", () => {
    const hrefs = getVisibleNavItems("manager").map((i) => i.href);
    for (const href of [
      "/admin/contact",
      "/admin/directory",
      "/admin/settings",
      "/admin/invoices",
      "/admin/payments",
      "/admin/customers",
      "/admin/profile/payment",
      "/rollcall",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  test("no role sees the same link twice", () => {
    for (const role of roles) {
      const keys = getVisibleNavItems(role).map((i) => i.href);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test("every nav item has at least one role", () => {
    expect(NAV_ITEMS.every((i) => i.roles.length > 0)).toBe(true);
  });
});
