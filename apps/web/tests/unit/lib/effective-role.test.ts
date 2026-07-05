/**
 * Unit tests for resolveEffectiveRole — the pure core of the Super Admin
 * "View As" feature. The critical property under test: the view-as cookie can
 * only ever LOWER privileges. It is ignored for every real role except
 * super_admin, and even for super_admin it only accepts the VIEW_AS_ROLES
 * allowlist (manager/instructor/inspector — never super_admin or customer).
 */

import { describe, it, expect } from "vitest";
import {
  resolveEffectiveRole,
  VIEW_AS_ROLES,
} from "@/lib/auth/effective-role";
import type { UserRole } from "@/types/users";

const ALL_ROLES: UserRole[] = [
  "customer",
  "instructor",
  "manager",
  "super_admin",
  "inspector",
];

describe("resolveEffectiveRole", () => {
  it("downgrades a super_admin to each allowlisted view-as role", () => {
    for (const role of VIEW_AS_ROLES) {
      expect(resolveEffectiveRole("super_admin", role)).toBe(role);
    }
  });

  it("ignores a missing cookie", () => {
    for (const role of ALL_ROLES) {
      expect(resolveEffectiveRole(role, undefined)).toBe(role);
    }
  });

  it("ignores an empty-string cookie", () => {
    expect(resolveEffectiveRole("super_admin", "")).toBe("super_admin");
  });

  it("never honors 'super_admin' or 'customer' as a cookie value", () => {
    expect(resolveEffectiveRole("super_admin", "super_admin")).toBe("super_admin");
    expect(resolveEffectiveRole("super_admin", "customer")).toBe("super_admin");
  });

  it("ignores garbage cookie values", () => {
    for (const garbage of ["admin", "SUPER_ADMIN", "Manager", "instructor ", "1", "null"]) {
      expect(resolveEffectiveRole("super_admin", garbage)).toBe("super_admin");
    }
  });

  it("never changes the role for non-super_admin users (no escalation)", () => {
    const nonSuperAdmins = ALL_ROLES.filter((r) => r !== "super_admin");
    const attemptedValues = [...ALL_ROLES, "garbage", ""];
    for (const realRole of nonSuperAdmins) {
      for (const cookie of attemptedValues) {
        expect(resolveEffectiveRole(realRole, cookie)).toBe(realRole);
      }
    }
  });
});
