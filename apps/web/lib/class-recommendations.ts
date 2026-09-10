/**
 * The class-finder decision table.
 *
 * This is the content behind /find-a-class: which class we recommend for a given
 * job, and which one we recommend for a personal (non-work) reason. It lives in
 * code rather than the database because it changes rarely and because getting it
 * wrong is a correctness problem, not a preference: recommending Heartsaver to
 * someone whose employer requires BLS sends them home with a card their hospital
 * will not accept.
 *
 * Classes are referenced by SLUG, derived from class_types.name via
 * lib/class-slug.ts. That is also what /book?class= expects, so a recommendation
 * hands off to the schedule without translation. Because course names are edited
 * in the admin, each course lists its known name variants and resolves to the
 * first that exists in the live catalog. If a rename escapes that list the
 * walkthrough degrades to a request rather than a broken page, and
 * tests/e2e/find-a-class.spec.ts fails because the course name stops rendering.
 *
 * Note on the job list: eight of the eleven roles resolve to the same two
 * Heartsaver outcomes. That redundancy is deliberate and should not be
 * "simplified" into a single yes/no question. Seeing their own job named is what
 * makes someone confident enough to book without calling, which is the entire
 * point of the feature.
 */

/** A class we suggest alongside the primary recommendation. */
export interface RecommendedAlternate {
  /** Candidate slugs for the alternate class, best match first. */
  candidates: string[];
  /** One line on who should pick this instead. */
  reason: string;
}

/** The outcome of a completed walkthrough. */
export interface Recommendation {
  /**
   * Candidate slugs for the class we lead with, best match first. The caller
   * takes the first one present in the live catalog. An empty array means no
   * catalog class fits and the visitor should request a class instead.
   */
  primaryCandidates: string[];
  /** Closely related options, shown under the primary recommendation. */
  alternates: RecommendedAlternate[];
  /** Plain-English reason this class was chosen, shown to the visitor. */
  rationale: string;
}

// ── Class slugs ─────────────────────────────────────────────────────────────
// Each course is a list of candidate slugs rather than one, resolved against the
// live catalog in order. Course names are edited in the admin and are not
// identical between environments (production sells "Basic Life Support (BLS)
// Renewals" where staging has "Basic Life Support (BLS)"), so pinning a single
// exact slug would leave the walkthrough dead-ending on whichever environment
// lost the coin toss. Listing the known variants keeps a rename from silently
// orphaning a mapping, and if none of them match, the walkthrough falls back to
// a request rather than showing a broken result.

const BLS = ["basic-life-support-bls-renewals", "basic-life-support-bls"];
const ACLS = [
  "advanced-cardiac-life-support-acls-renewals",
  "advanced-cardiac-life-support-acls",
];
const BLOODBORNE = ["blood-borne-pathogens", "bloodborne-pathogens"];
const HEARTSAVER_CPR = ["heartsaver-cpr-aed"];
const HEARTSAVER_FIRST_AID = ["heartsaver-first-aid"];
const HEARTSAVER_COMBINED = ["heartsaver-first-aid-cpr-aed"];
const FAMILY_FRIENDS = ["family-friends-cpr"];

const HEARTCODE_BLS = ["heartcode-bls-skills-assessment"];
const HEARTCODE_ACLS = ["heartcode-acls-skills-assessment"];
const ONLINE_HEARTSAVER_CPR = ["online-heartsaver-cpr-aed-skills-assessment"];
const ONLINE_HEARTSAVER_FIRST_AID = [
  "online-heartsaver-first-aid-skills-assessment",
];
const ONLINE_HEARTSAVER_COMBINED = [
  "online-heartsaver-first-aid-cpr-aed-skills-assessment",
];

/**
 * Blended-learning counterpart for each in-person class.
 *
 * AHA sells several courses as "do the coursework online, come in for the hands-on
 * skills check". Someone whose employer already bought them the online portion
 * needs the skills check only, and would otherwise pay for and sit through the
 * full class. Offering it as an alternate is how those products stay findable.
 */
const SKILLS_CHECK_ALTERNATE: Array<{ course: string[]; alternate: string[] }> = [
  { course: BLS, alternate: HEARTCODE_BLS },
  { course: ACLS, alternate: HEARTCODE_ACLS },
  { course: HEARTSAVER_CPR, alternate: ONLINE_HEARTSAVER_CPR },
  { course: HEARTSAVER_FIRST_AID, alternate: ONLINE_HEARTSAVER_FIRST_AID },
  { course: HEARTSAVER_COMBINED, alternate: ONLINE_HEARTSAVER_COMBINED },
];

/**
 * Builds the blended-learning alternate for a course, when one exists.
 * @param course - Candidate slugs of the primary recommended course.
 * @returns A single-item array, or an empty array when the course has no
 *   online-plus-skills-check counterpart.
 */
function skillsCheckAlternates(course: string[]): RecommendedAlternate[] {
  const match = SKILLS_CHECK_ALTERNATE.find((e) => e.course === course);
  if (!match) return [];

  return [
    {
      candidates: match.alternate,
      reason:
        "Pick this only if you have already completed the online coursework and need the in-person skills check.",
    },
  ];
}

// ── Job branch ──────────────────────────────────────────────────────────────

/** Where a job role points once selected. */
export type JobTarget =
  /** Resolves straight to one course. */
  | { kind: "class"; course: string[]; rationale: string }
  /**
   * Resolves to a Heartsaver course, but only after asking whether the visitor
   * also needs First Aid. Employers differ on this and we should not guess.
   */
  | { kind: "heartsaver" }
  /** No catalog class fits well enough to recommend without talking first. */
  | { kind: "request"; rationale: string };

/** One selectable job on the "what do you do?" step. */
export interface JobRole {
  /** Stable identifier, used in wizard state and tests. */
  id: string;
  /** Button label. */
  label: string;
  /** Example jobs, shown under the label so people recognise themselves. */
  examples: string;
  target: JobTarget;
}

/**
 * Every job offered on the job branch, in display order.
 *
 * Ordering is deliberate: the two clinical roles lead because they are the ones
 * with a wrong answer that costs someone a job requirement, and "Something else"
 * is last because it is the fallback.
 */
export const JOB_ROLES: JobRole[] = [
  {
    id: "healthcare",
    label: "Healthcare or clinical staff",
    examples:
      "Nurse, doctor, EMT, paramedic, medical or dental assistant, home health aide, therapist, nursing or medical student",
    target: {
      kind: "class",
      course: BLS,
      rationale:
        "Anyone in a patient-care role needs Basic Life Support. If your employer or school asks for AHA BLS, a Heartsaver card will not be accepted in its place.",
    },
  },
  {
    id: "critical-care",
    label: "Critical or acute care",
    examples: "ICU, ER, anesthesia tech, physician in emergency or acute care",
    target: {
      kind: "class",
      course: ACLS,
      rationale:
        "Advanced Cardiovascular Life Support is the standard for higher-acuity roles. It builds on BLS, so most employers expect you to hold both.",
    },
  },
  {
    id: "teacher",
    label: "Teacher or school staff",
    examples: "K-12 teacher, coach, teaching aide, school administrator",
    target: { kind: "heartsaver" },
  },
  {
    id: "childcare",
    label: "Childcare or daycare",
    examples: "Daycare worker, preschool staff, nanny, foster parent",
    target: { kind: "heartsaver" },
  },
  {
    id: "fitness",
    label: "Fitness or wellness",
    examples: "Personal trainer, group fitness instructor, gym staff, massage therapist",
    target: { kind: "heartsaver" },
  },
  {
    id: "workplace-safety",
    label: "Workplace safety or first-aid responder",
    examples: "Safety officer, HR, the designated first-aid person in an office",
    target: { kind: "heartsaver" },
  },
  {
    id: "camp-youth",
    label: "Camp or youth programs",
    examples: "Camp counselor, youth sports, after-school program staff",
    target: { kind: "heartsaver" },
  },
  {
    id: "construction",
    label: "Construction or industrial",
    examples: "Construction, manufacturing, warehouse, trades",
    target: { kind: "heartsaver" },
  },
  {
    id: "caregiving",
    label: "Personal care or caregiving",
    examples: "Non-medical caregiver, companion, personal care aide",
    target: { kind: "heartsaver" },
  },
  {
    id: "security",
    label: "Security or corrections",
    examples: "Security officer, corrections officer, loss prevention",
    target: { kind: "heartsaver" },
  },
  {
    id: "boat-captain",
    label: "Boat captain",
    examples: "USCG-licensed captain, charter or tow boat operator",
    target: {
      kind: "class",
      course: HEARTSAVER_COMBINED,
      rationale:
        "Boat captains are required to hold Heartsaver First Aid and CPR. Upon completion you will receive USCG Form Amerha-216, which you will need for your license.",
    },
  },
  {
    id: "body-art",
    label: "Body art or cosmetology",
    examples: "Tattoo artist, piercer, cosmetologist, nail technician",
    target: {
      kind: "class",
      course: BLOODBORNE,
      rationale:
        "OSHA requires bloodborne pathogens training for anyone whose work exposes them to blood, which covers body art and many cosmetology licenses.",
    },
  },
  {
    id: "other",
    label: "Something else",
    examples: "Your job is not listed, or you are not sure it fits any of these",
    target: {
      kind: "request",
      rationale:
        "We would rather match you to the right course than guess. Send us a request and we will confirm what your employer needs.",
    },
  },
];

/**
 * Resolves a job selection into a recommendation.
 *
 * @param roleId - The selected JobRole id.
 * @param needsFirstAid - Answer to the First Aid follow-up. Only consulted for
 *   Heartsaver-tier roles; ignored for clinical and bloodborne roles, which do
 *   not ask the question.
 * @returns The recommendation to display, or a request-a-class outcome.
 */
export function resolveJobRecommendation(
  roleId: string,
  needsFirstAid: boolean
): Recommendation {
  const role = JOB_ROLES.find((r) => r.id === roleId);

  if (!role) {
    return {
      primaryCandidates: [],
      alternates: [],
      rationale:
        "We could not match that selection to a course. Send us a request and we will point you to the right one.",
    };
  }

  if (role.target.kind === "request") {
    return {
      primaryCandidates: [],
      alternates: [],
      rationale: role.target.rationale,
    };
  }

  if (role.target.kind === "class") {
    return {
      primaryCandidates: role.target.course,
      alternates: skillsCheckAlternates(role.target.course),
      rationale: role.target.rationale,
    };
  }

  const course = needsFirstAid ? HEARTSAVER_COMBINED : HEARTSAVER_CPR;
  return {
    primaryCandidates: course,
    alternates: skillsCheckAlternates(course),
    rationale: needsFirstAid
      ? "Heartsaver covers workplace and community responders, and this version adds the First Aid training your role calls for. It is a full AHA certification."
      : "Heartsaver is the AHA certification built for workplace and community responders rather than clinical staff. It is a full certification your employer can accept.",
  };
}

// ── Personal branch ─────────────────────────────────────────────────────────

/** What kind of training a personal (non-work) visitor is after. */
export type PersonalTraining = "cpr" | "first_aid" | "both";

/**
 * Resolves the personal branch into a recommendation.
 *
 * The certified/not-certified split is a real price difference: the
 * non-certified course is cheaper and is taught by the same instructors, but it
 * issues no card, so it suits someone learning for their own family rather than
 * for a requirement.
 *
 * @param training - Whether they want CPR, First Aid, or both.
 * @param certified - True when they need an AHA certification card.
 * @returns The recommendation to display, or a request-a-class outcome.
 */
export function resolvePersonalRecommendation(
  training: PersonalTraining,
  certified: boolean
): Recommendation {
  if (certified) {
    const course =
      training === "cpr"
        ? HEARTSAVER_CPR
        : training === "first_aid"
          ? HEARTSAVER_FIRST_AID
          : HEARTSAVER_COMBINED;

    return {
      primaryCandidates: course,
      alternates: skillsCheckAlternates(course),
      rationale:
        "This is a full American Heart Association certification, so you finish with a card that employers and schools accept.",
    };
  }

  if (training === "cpr") {
    return {
      primaryCandidates: FAMILY_FRIENDS,
      alternates: [],
      rationale:
        "Family and Friends CPR teaches the same skills as our certification courses, with the same instructors, at a lower price. It does not issue a certification card, so choose it only if nobody is requiring one.",
    };
  }

  // TODO: point non-certified First Aid at its own class type once that class
  // exists in the catalog. Until then these visitors go through a request so we
  // do not silently upsell them into the certified course they said they did not
  // need.
  return {
    primaryCandidates: [],
    alternates: [],
    rationale:
      "We teach non-certified First Aid, but it is not on the public schedule yet. Send us a request and we will arrange a date with you.",
  };
}

/**
 * Every candidate slug this table can recommend, across all courses.
 * Used by the unit invariant that checks each one is well formed, and as the
 * inventory a reviewer can compare against the live catalog.
 */
export function allReferencedSlugs(): string[] {
  const slugs = new Set<string>([
    ...BLS,
    ...ACLS,
    ...BLOODBORNE,
    ...HEARTSAVER_CPR,
    ...HEARTSAVER_FIRST_AID,
    ...HEARTSAVER_COMBINED,
    ...FAMILY_FRIENDS,
    ...SKILLS_CHECK_ALTERNATE.flatMap((e) => e.alternate),
  ]);
  return [...slugs];
}
