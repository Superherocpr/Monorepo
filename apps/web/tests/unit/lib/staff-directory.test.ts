/**
 * Unit tests for groupStaffByRole, the grouping/sort logic behind the
 * Staff Directory page (/admin/directory).
 */
import { describe, test, expect } from "vitest";
import { groupStaffByRole, type DirectoryMember } from "@/lib/staff-directory";

function member(overrides: Partial<DirectoryMember>): DirectoryMember {
  return {
    id: "id",
    first_name: "First",
    last_name: "Last",
    email: "person@example.com",
    phone: "555-0100",
    role: "instructor",
    directory_title: null,
    ...overrides,
  };
}

describe("groupStaffByRole", () => {
  test("groups members under their role", () => {
    const groups = groupStaffByRole([
      member({ id: "1", role: "instructor" }),
      member({ id: "2", role: "super_admin" }),
    ]);

    expect(groups.map((g) => g.role)).toEqual(["super_admin", "instructor"]);
    expect(groups.find((g) => g.role === "super_admin")?.members.map((m) => m.id)).toEqual(["2"]);
    expect(groups.find((g) => g.role === "instructor")?.members.map((m) => m.id)).toEqual(["1"]);
  });

  test("orders groups super_admin, manager, instructor, inspector regardless of input order", () => {
    const groups = groupStaffByRole([
      member({ id: "1", role: "inspector" }),
      member({ id: "2", role: "instructor" }),
      member({ id: "3", role: "manager" }),
      member({ id: "4", role: "super_admin" }),
    ]);

    expect(groups.map((g) => g.role)).toEqual([
      "super_admin",
      "manager",
      "instructor",
      "inspector",
    ]);
  });

  test("omits roles with no members instead of rendering an empty group", () => {
    const groups = groupStaffByRole([member({ id: "1", role: "instructor" })]);

    expect(groups).toHaveLength(1);
    expect(groups[0].role).toBe("instructor");
  });

  test("sorts members within a group by last name", () => {
    const groups = groupStaffByRole([
      member({ id: "1", role: "instructor", last_name: "Zephyr" }),
      member({ id: "2", role: "instructor", last_name: "Adams" }),
      member({ id: "3", role: "instructor", last_name: "Martinez" }),
    ]);

    expect(groups[0].members.map((m) => m.last_name)).toEqual(["Adams", "Martinez", "Zephyr"]);
  });

  test("returns an empty array for no members", () => {
    expect(groupStaffByRole([])).toEqual([]);
  });

  test("does not mutate the input array", () => {
    const input = [
      member({ id: "1", role: "instructor", last_name: "Zephyr" }),
      member({ id: "2", role: "instructor", last_name: "Adams" }),
    ];
    const inputCopy = [...input];

    groupStaffByRole(input);

    expect(input).toEqual(inputCopy);
  });
});
