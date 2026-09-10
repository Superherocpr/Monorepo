/**
 * Unit tests for lib/class-recommendations.ts
 *
 * Guards the decision table behind /find-a-class. The failure this is really
 * watching for is a wrong recommendation rather than a crash: sending a nurse to
 * Heartsaver produces a card their employer will reject, and the visitor has no
 * way to know we got it wrong.
 */
import { describe, test, expect } from "vitest";
import {
  JOB_ROLES,
  allReferencedSlugs,
  resolveJobRecommendation,
  resolvePersonalRecommendation,
} from "@/lib/class-recommendations";
import { toSlug } from "@/lib/class-slug";

describe("JOB_ROLES", () => {
  test("every role has an id, label, and examples", () => {
    for (const role of JOB_ROLES) {
      expect(role.id).toBeTruthy();
      expect(role.label).toBeTruthy();
      expect(role.examples).toBeTruthy();
    }
  });

  test("role ids are unique", () => {
    const ids = JOB_ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("includes a catch-all that routes to a request", () => {
    const other = JOB_ROLES.find((r) => r.id === "other");
    expect(other?.target.kind).toBe("request");
  });
});

describe("resolveJobRecommendation", () => {
  test("clinical work resolves to BLS, never Heartsaver", () => {
    const rec = resolveJobRecommendation("healthcare", false);
    expect(rec.primaryCandidates).toContain("basic-life-support-bls-renewals");
  });

  test("clinical work ignores the First Aid answer", () => {
    // The question is never asked for this branch; if it were ever wired up by
    // mistake, the recommendation must not change.
    const withFirstAid = resolveJobRecommendation("healthcare", true);
    const without = resolveJobRecommendation("healthcare", false);
    expect(withFirstAid.primaryCandidates).toEqual(without.primaryCandidates);
  });

  test("critical care resolves to ACLS", () => {
    const rec = resolveJobRecommendation("critical-care", false);
    expect(rec.primaryCandidates).toContain("advanced-cardiac-life-support-acls-renewals");
  });

  test("body art resolves to bloodborne pathogens", () => {
    const rec = resolveJobRecommendation("body-art", false);
    expect(rec.primaryCandidates).toContain("blood-borne-pathogens");
  });

  test("Heartsaver roles branch on the First Aid answer", () => {
    const heartsaverRoles = JOB_ROLES.filter(
      (r) => r.target.kind === "heartsaver"
    );
    expect(heartsaverRoles.length).toBeGreaterThan(0);

    for (const role of heartsaverRoles) {
      expect(resolveJobRecommendation(role.id, false).primaryCandidates).toContain("heartsaver-cpr-aed");
      expect(resolveJobRecommendation(role.id, true).primaryCandidates).toContain("heartsaver-first-aid-cpr-aed");
    }
  });

  test("the catch-all role recommends no class", () => {
    const rec = resolveJobRecommendation("other", false);
    expect(rec.primaryCandidates).toHaveLength(0);
    expect(rec.rationale).toBeTruthy();
  });

  test("an unknown role degrades to a request rather than throwing", () => {
    const rec = resolveJobRecommendation("not-a-real-role", false);
    expect(rec.primaryCandidates).toHaveLength(0);
    expect(rec.rationale).toBeTruthy();
  });

  test("every recommendation carries a rationale to show the visitor", () => {
    for (const role of JOB_ROLES) {
      for (const firstAid of [true, false]) {
        expect(
          resolveJobRecommendation(role.id, firstAid).rationale.length
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("resolvePersonalRecommendation", () => {
  test("certified answers map to the AHA Heartsaver courses", () => {
    expect(resolvePersonalRecommendation("cpr", true).primaryCandidates).toContain("heartsaver-cpr-aed");
    expect(resolvePersonalRecommendation("first_aid", true).primaryCandidates).toContain("heartsaver-first-aid");
    expect(resolvePersonalRecommendation("both", true).primaryCandidates).toContain("heartsaver-first-aid-cpr-aed");
  });

  test("non-certified CPR maps to Family and Friends", () => {
    const rec = resolvePersonalRecommendation("cpr", false);
    expect(rec.primaryCandidates).toContain("family-friends-cpr");
  });

  test("non-certified CPR is offered with no card, stated plainly", () => {
    const rec = resolvePersonalRecommendation("cpr", false);
    expect(rec.rationale.toLowerCase()).toContain("card");
  });

  test("non-certified First Aid routes to a request until that class exists", () => {
    // TODO: flip these to the non-certified First Aid slug once the class type
    // is created. Until then a request is the honest outcome, not an upsell.
    expect(resolvePersonalRecommendation("first_aid", false).primaryCandidates).toHaveLength(0);
    expect(resolvePersonalRecommendation("both", false).primaryCandidates).toHaveLength(0);
  });
});

describe("referenced slugs", () => {
  test("are well formed, with no leading or trailing dashes", () => {
    for (const slug of allReferencedSlugs()) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  test("round-trip through toSlug unchanged", () => {
    // Proves the table stores real slugs rather than hand-typed approximations,
    // so a mapping entry cannot drift from what toSlug produces for a name.
    for (const slug of allReferencedSlugs()) {
      expect(toSlug(slug)).toBe(slug);
    }
  });

  test("include every class the job and personal branches can return", () => {
    const referenced = new Set(allReferencedSlugs());

    for (const role of JOB_ROLES) {
      for (const firstAid of [true, false]) {
        const rec = resolveJobRecommendation(role.id, firstAid);
        for (const slug of rec.primaryCandidates) {
          expect(referenced.has(slug)).toBe(true);
        }
        for (const alt of rec.alternates) {
          for (const slug of alt.candidates) {
            expect(referenced.has(slug)).toBe(true);
          }
        }
      }
    }

    for (const training of ["cpr", "first_aid", "both"] as const) {
      for (const certified of [true, false]) {
        const rec = resolvePersonalRecommendation(training, certified);
        for (const slug of rec.primaryCandidates) {
          expect(referenced.has(slug)).toBe(true);
        }
        for (const alt of rec.alternates) {
          for (const slug of alt.candidates) {
            expect(referenced.has(slug)).toBe(true);
          }
        }
      }
    }
  });
});
