/**
 * Unit tests for groupStaffByRole, buildClassesTaughtMap, and
 * resolveDirectoryEmail: the grouping, sort, classes-taught, and
 * email-override logic behind the Staff Directory page (/admin/directory).
 */
import { describe, test, expect } from "vitest";
import {
  groupStaffByRole,
  buildClassesTaughtMap,
  resolveDirectoryEmail,
  resolveDirectoryPhone,
  type DirectoryMember,
} from "@/lib/staff-directory";

function member(overrides: Partial<DirectoryMember>): DirectoryMember {
  return {
    id: "id",
    first_name: "First",
    last_name: "Last",
    email: "person@example.com",
    phone: "555-0100",
    role: "instructor",
    directory_title: null,
    directory_email: null,
    directory_phone: null,
    classesTaught: [],
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

describe("buildClassesTaughtMap", () => {
  test("dedupes repeated class types for the same instructor", () => {
    const map = buildClassesTaughtMap([
      { instructor_id: "1", class_type_name: "BLS" },
      { instructor_id: "1", class_type_name: "BLS" },
      { instructor_id: "1", class_type_name: "Heartsaver" },
    ]);

    expect(map["1"]).toEqual(["BLS", "Heartsaver"]);
  });

  test("keeps each instructor's list separate", () => {
    const map = buildClassesTaughtMap([
      { instructor_id: "1", class_type_name: "BLS" },
      { instructor_id: "2", class_type_name: "ACLS" },
    ]);

    expect(map["1"]).toEqual(["BLS"]);
    expect(map["2"]).toEqual(["ACLS"]);
  });

  test("sorts class names alphabetically", () => {
    const map = buildClassesTaughtMap([
      { instructor_id: "1", class_type_name: "Heartsaver" },
      { instructor_id: "1", class_type_name: "ACLS" },
      { instructor_id: "1", class_type_name: "BLS" },
    ]);

    expect(map["1"]).toEqual(["ACLS", "BLS", "Heartsaver"]);
  });

  test("skips rows with a null instructor_id or class_type_name", () => {
    const map = buildClassesTaughtMap([
      { instructor_id: null, class_type_name: "BLS" },
      { instructor_id: "1", class_type_name: null },
      { instructor_id: "1", class_type_name: "BLS" },
    ]);

    expect(Object.keys(map)).toEqual(["1"]);
    expect(map["1"]).toEqual(["BLS"]);
  });

  test("returns an empty object for no rows", () => {
    expect(buildClassesTaughtMap([])).toEqual({});
  });
});

describe("resolveDirectoryEmail", () => {
  test("returns the override email when set", () => {
    const person = member({ email: "real@example.com", directory_email: "shared@example.com" });
    expect(resolveDirectoryEmail(person)).toBe("shared@example.com");
  });

  test("falls back to the real email when no override is set", () => {
    const person = member({ email: "real@example.com", directory_email: null });
    expect(resolveDirectoryEmail(person)).toBe("real@example.com");
  });
});

describe("resolveDirectoryPhone", () => {
  test("returns the override when set", () => {
    const person = member({ phone: "111-111-1111", directory_phone: "222-222-2222" });
    expect(resolveDirectoryPhone(person)).toBe("222-222-2222");
  });

  test("falls back to the real phone when no override is set", () => {
    const person = member({ phone: "111-111-1111", directory_phone: null });
    expect(resolveDirectoryPhone(person)).toBe("111-111-1111");
  });

  test("treats a blank override as unset", () => {
    const person = member({ phone: "111-111-1111", directory_phone: "   " });
    expect(resolveDirectoryPhone(person)).toBe("111-111-1111");
  });

  test("returns null when the real phone is the empty-string backfill and there is no override", () => {
    const person = member({ phone: "", directory_phone: null });
    expect(resolveDirectoryPhone(person)).toBeNull();
  });

  test("an override rescues a profile whose real phone is empty", () => {
    const person = member({ phone: "", directory_phone: "222-222-2222" });
    expect(resolveDirectoryPhone(person)).toBe("222-222-2222");
  });
});
