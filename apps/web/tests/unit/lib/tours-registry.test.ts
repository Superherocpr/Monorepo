/**
 * Unit tests for lib/tours/registry.ts
 *
 * Covers: canAccessTour, toursForRole. Both are pure functions; toursForRole
 * takes the walkthrough list as a parameter, so tests use fixture data
 * rather than the live TOURS export.
 */
import { describe, test, expect } from "vitest";
import { canAccessTour, toursForRole, type TourDefinition } from "@/lib/tours/registry";

const FIXTURES: TourDefinition[] = [
  {
    id: "create-session",
    title: "Submit a Class Session for Approval",
    description: "Create a new class session and send it in for approval.",
    roles: ["instructor"],
    href: "/admin/sessions",
  },
  {
    id: "manage-locations",
    title: "Add a New Location",
    description: "Add a teaching location managers can assign sessions to.",
    roles: ["manager"],
    href: "/admin/settings",
  },
];

describe("canAccessTour", () => {
  test("super_admin can access a walkthrough regardless of its tagged roles", () => {
    expect(canAccessTour(["instructor"], "super_admin")).toBe(true);
    expect(canAccessTour(["manager"], "super_admin")).toBe(true);
    expect(canAccessTour([], "super_admin")).toBe(true);
  });

  test("a non-super_admin role can access a walkthrough tagged for it", () => {
    expect(canAccessTour(["instructor"], "instructor")).toBe(true);
    expect(canAccessTour(["manager", "instructor"], "manager")).toBe(true);
  });

  test("a non-super_admin role cannot access a walkthrough not tagged for it", () => {
    expect(canAccessTour(["manager"], "instructor")).toBe(false);
    expect(canAccessTour(["instructor"], "manager")).toBe(false);
  });
});

describe("toursForRole", () => {
  test("returns only walkthroughs tagged for the given role", () => {
    expect(toursForRole(FIXTURES, "instructor")).toEqual([FIXTURES[0]]);
    expect(toursForRole(FIXTURES, "manager")).toEqual([FIXTURES[1]]);
  });

  test("super_admin sees every walkthrough regardless of its tagged roles, same as the Admin Feature Reference's canAccess model", () => {
    expect(toursForRole(FIXTURES, "super_admin")).toEqual(FIXTURES);
  });

  test("returns an empty array for a role with no matching walkthroughs", () => {
    expect(toursForRole(FIXTURES, "inspector")).toEqual([]);
  });

  test("returns an empty array when given an empty list", () => {
    expect(toursForRole([], "instructor")).toEqual([]);
    expect(toursForRole([], "super_admin")).toEqual([]);
  });
});
