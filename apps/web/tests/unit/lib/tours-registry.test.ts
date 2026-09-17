/**
 * Unit tests for lib/tours/registry.ts
 *
 * Covers: toursForRole, toursGroupedByRole.
 * Both are pure functions that take the walkthrough list as a parameter, so
 * tests use fixture data rather than the (currently empty) live TOURS export.
 */
import { describe, test, expect } from "vitest";
import { toursForRole, toursGroupedByRole, type TourDefinition } from "@/lib/tours/registry";

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
    roles: ["manager", "super_admin"],
    href: "/admin/settings",
  },
];

describe("toursForRole", () => {
  test("returns only walkthroughs whose roles include the given role", () => {
    expect(toursForRole(FIXTURES, "instructor")).toEqual([FIXTURES[0]]);
  });

  test("returns walkthroughs shared by multiple roles", () => {
    expect(toursForRole(FIXTURES, "manager")).toEqual([FIXTURES[1]]);
    expect(toursForRole(FIXTURES, "super_admin")).toEqual([FIXTURES[1]]);
  });

  test("returns an empty array for a role with no matching walkthroughs", () => {
    expect(toursForRole(FIXTURES, "inspector")).toEqual([]);
  });

  test("returns an empty array when given an empty list", () => {
    expect(toursForRole([], "instructor")).toEqual([]);
  });
});

describe("toursGroupedByRole", () => {
  test("groups walkthroughs under each requested role in the given order", () => {
    const groups = toursGroupedByRole(FIXTURES, ["instructor", "manager", "super_admin"]);
    expect(groups.map((g) => g.role)).toEqual(["instructor", "manager", "super_admin"]);
    expect(groups[0].tours).toEqual([FIXTURES[0]]);
    expect(groups[1].tours).toEqual([FIXTURES[1]]);
    expect(groups[2].tours).toEqual([FIXTURES[1]]);
  });

  test("omits roles with no matching walkthroughs instead of returning an empty group", () => {
    const groups = toursGroupedByRole(FIXTURES, ["instructor", "inspector"]);
    expect(groups).toEqual([{ role: "instructor", tours: [FIXTURES[0]] }]);
  });

  test("returns an empty array when no requested role has any walkthroughs", () => {
    expect(toursGroupedByRole([], ["instructor", "manager"])).toEqual([]);
  });
});
