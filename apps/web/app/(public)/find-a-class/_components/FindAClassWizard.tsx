"use client";

/**
 * FindAClassWizard — the guided "which class do I need?" walkthrough.
 *
 * Runs the decision tree in lib/class-recommendations.ts and ends every path at
 * one of two places: the schedule (/book, filtered to the recommended class) when
 * dates exist, or /request-class when they do not. Nothing here can dead-end.
 *
 * Navigation is a history stack rather than a step index, because the branches
 * are different depths: a group booking leaves at question one, while a personal
 * certification takes four. A stack gives correct Back behaviour without any
 * branch-aware arithmetic.
 *
 * Used by: app/(public)/find-a-class/page.tsx
 */

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarCheck, ChevronRight, MailQuestion, RotateCcw } from "lucide-react";
import {
  JOB_ROLES,
  resolveJobRecommendation,
  resolvePersonalRecommendation,
  type PersonalTraining,
  type Recommendation,
} from "@/lib/class-recommendations";
import { formatDuration, formatPrice } from "@/lib/class-display";

/** A class type plus how bookable it currently is, as prepared by the page. */
export interface FinderClassOption {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  isAha: boolean;
  /**
   * Upcoming, approved, public sessions that still have a seat free. Used only
   * to decide whether the result screen offers "book" or "request" — deliberately
   * never rendered as a count or date. Showing scarcity partway through the
   * walkthrough (e.g. while still browsing the class list) gives a visitor a
   * reason to bounce before they ever see the recommendation, for no benefit:
   * they cannot act on that information until they reach the end anyway.
   */
  upcomingCount: number;
}

interface Props {
  classes: FinderClassOption[];
}

/** One screen of the walkthrough. */
type Step =
  | { name: "start" }
  | { name: "known" }
  | { name: "class-list" }
  | { name: "purpose" }
  | { name: "job" }
  | { name: "job-first-aid"; roleId: string }
  | { name: "personal-training" }
  | { name: "personal-cert"; training: PersonalTraining }
  | { name: "result"; recommendation: Recommendation };

// ── Shared pieces ───────────────────────────────────────────────────────────

const CARD =
  "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm";

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2";

/**
 * A large, tappable answer button.
 * @param label - The answer text.
 * @param hint - Optional supporting line, used for job examples.
 * @param onClick - Handler advancing the walkthrough.
 */
function OptionButton({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left border border-gray-200 dark:border-gray-700 rounded-xl px-5 py-4 bg-white dark:bg-gray-900 hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50/40 dark:hover:bg-red-950/20 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 flex items-start gap-4"
    >
      <span className="flex-1">
        <span className="block font-semibold text-gray-900 dark:text-white">
          {label}
        </span>
        {hint && (
          <span className="block text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
            {hint}
          </span>
        )}
      </span>
      <ChevronRight
        size={20}
        aria-hidden="true"
        className="shrink-0 mt-0.5 text-gray-300 dark:text-gray-600 group-hover:text-red-500 transition-colors duration-150"
      />
    </button>
  );
}

/**
 * A question heading with its supporting line.
 * @param title - The question.
 * @param subtitle - Optional clarifying copy beneath it.
 */
function QuestionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): React.ReactElement {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-semibold text-gray-900 dark:text-white text-balance">
        {title}
      </h2>
      {subtitle && (
        <p className="text-gray-600 dark:text-gray-400 mt-2 leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/**
 * A row of pills marking questions already answered.
 * Deliberately has no fixed total — branch depth ranges from one question
 * (group/workplace exits immediately) to four (personal certification), so a
 * bar that claimed to know the finish line would be wrong most of the time.
 * It only ever grows, never predicts.
 * @param count - Answers given so far (trail.length).
 */
function StepDots({ count }: { count: number }): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <div className="flex items-center gap-1.5 mb-5" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="h-1.5 w-6 rounded-full bg-red-500 dark:bg-red-500/80"
        />
      ))}
    </div>
  );
}

// ── Wizard ──────────────────────────────────────────────────────────────────

/**
 * Renders the walkthrough.
 * @param classes - Active class types with availability, from the server page.
 */
export default function FindAClassWizard({ classes }: Props): React.ReactElement {
  const [history, setHistory] = useState<Step[]>([{ name: "start" }]);
  const [trail, setTrail] = useState<string[]>([]);

  const step = history[history.length - 1];
  const bySlug = useMemo(
    () => new Map(classes.map((c) => [c.slug, c])),
    [classes]
  );

  /**
   * Advances to the next screen, recording the answer for the breadcrumb.
   * @param next - The screen to show.
   * @param label - The answer just given, shown in the trail.
   */
  function go(next: Step, label: string): void {
    setHistory((h) => [...h, next]);
    setTrail((t) => [...t, label]);
  }

  /** Returns to the previous screen. */
  function back(): void {
    if (history.length <= 1) return;
    setHistory((h) => h.slice(0, -1));
    setTrail((t) => t.slice(0, -1));
  }

  /** Clears all answers and returns to the first question. */
  function restart(): void {
    setHistory([{ name: "start" }]);
    setTrail([]);
  }

  /**
   * Resolves a job role, asking the First Aid follow-up only for the Heartsaver
   * roles that genuinely branch on it.
   * @param roleId - The selected role.
   * @param label - Role label, for the breadcrumb.
   */
  function chooseJob(roleId: string, label: string): void {
    const role = JOB_ROLES.find((r) => r.id === roleId);
    if (role?.target.kind === "heartsaver") {
      go({ name: "job-first-aid", roleId }, label);
      return;
    }
    go(
      { name: "result", recommendation: resolveJobRecommendation(roleId, false) },
      label
    );
  }

  return (
    <main className="bg-red-600 dark:bg-red-900 min-h-[calc(100vh-4rem)] py-12 sm:py-16 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Page header — sits directly on the red backdrop, so this text is white rather than the gray used everywhere else. */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white text-balance">
            Which class do I need?
          </h1>
          <p className="text-white/80 mt-2 leading-relaxed">
            A few questions and we will point you to the right course. No phone
            call required.
          </p>
        </div>

        {/* Answer trail */}
        {trail.length > 0 && (
          <nav aria-label="Your answers" className="mb-4">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/70">
              {trail.map((answer, i) => (
                <li key={i} className="flex items-center gap-2">
                  {i > 0 && (
                    <span aria-hidden="true" className="text-white/40">
                      /
                    </span>
                  )}
                  <span>{answer}</span>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className={`${CARD} p-6 sm:p-8`}>
        <div key={`${history.length}-${step.name}`} className="animate-wizard-step">
          <StepDots count={trail.length} />
          {step.name === "start" && (
            <>
              <QuestionHeading
                title="Who is this class for?"
                subtitle="This is the only question that changes how you book."
              />
              <div className="flex flex-col gap-3">
                <OptionButton
                  label="Just me"
                  hint="One person booking a seat in a class"
                  onClick={() => go({ name: "known" }, "Just me")}
                />
                <Link
                  href="/request-class"
                  className="group w-full text-left border border-gray-200 dark:border-gray-700 rounded-xl px-5 py-4 bg-white dark:bg-gray-900 hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50/40 dark:hover:bg-red-950/20 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 flex items-start gap-4"
                >
                  <span className="flex-1">
                    <span className="block font-semibold text-gray-900 dark:text-white">
                      A group or workplace
                    </span>
                    <span className="block text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                      We come to you and teach your team on site
                    </span>
                  </span>
                  <ChevronRight
                    size={20}
                    aria-hidden="true"
                    className="shrink-0 mt-0.5 text-gray-300 dark:text-gray-600 group-hover:text-red-500 transition-colors duration-150"
                  />
                </Link>
                {/*
                 * The escape hatch for anyone who does not want the walkthrough at
                 * all. Same size and shape as the two options above it, with the
                 * usual title color swapped to red — the subtitle stays the same
                 * gray hint color as the other buttons — so it reads as the "skip
                 * this" option rather than a third equal choice.
                 */}
                <Link
                  href="/book"
                  className="group w-full text-left border border-gray-200 dark:border-gray-700 rounded-xl px-5 py-4 bg-white dark:bg-gray-900 hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50/40 dark:hover:bg-red-950/20 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 flex items-start gap-4"
                >
                  <span className="flex-1">
                    <span className="block font-semibold text-red-600 dark:text-red-400">
                      I already know what I need
                    </span>
                    <span className="block text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                      Show me the schedule
                    </span>
                  </span>
                  <ChevronRight
                    size={20}
                    aria-hidden="true"
                    className="shrink-0 mt-0.5 text-gray-300 dark:text-gray-600 group-hover:text-red-500 transition-colors duration-150"
                  />
                </Link>
              </div>
            </>
          )}

          {step.name === "known" && (
            <>
              <QuestionHeading title="Do you know which class you need?" />
              <div className="flex flex-col gap-3">
                <OptionButton
                  label="Yes, I know the course name"
                  onClick={() => go({ name: "class-list" }, "I know the course")}
                />
                <OptionButton
                  label="No, help me figure it out"
                  onClick={() => go({ name: "purpose" }, "Help me choose")}
                />
              </div>
            </>
          )}

          {step.name === "class-list" && (
            <>
              <QuestionHeading
                title="Which course do you need?"
                subtitle="Pick one and we will show you what is scheduled."
              />
              <div className="flex flex-col gap-3">
                {classes.map((c) => (
                  <OptionButton
                    key={c.id}
                    label={c.name}
                    hint={`${formatDuration(c.durationMinutes)} · ${formatPrice(c.price)} per person`}
                    onClick={() =>
                      go(
                        {
                          name: "result",
                          recommendation: {
                            primaryCandidates: [c.slug],
                            alternates: [],
                            rationale: "You picked this course yourself.",
                          },
                        },
                        c.name
                      )
                    }
                  />
                ))}
              </div>
            </>
          )}

          {step.name === "purpose" && (
            <>
              <QuestionHeading title="Why do you need this training?" />
              <div className="flex flex-col gap-3">
                <OptionButton
                  label="For my job"
                  hint="An employer, school, or license requires it"
                  onClick={() => go({ name: "job" }, "For my job")}
                />
                <OptionButton
                  label="For myself or my family"
                  hint="Nobody is requiring it, you want the skills"
                  onClick={() => go({ name: "personal-training" }, "Personal")}
                />
              </div>
            </>
          )}

          {step.name === "job" && (
            <>
              <QuestionHeading
                title="What kind of work do you do?"
                subtitle="Find the closest match. This decides whether you need a clinical course or a workplace one."
              />
              <div className="flex flex-col gap-3">
                {JOB_ROLES.map((role) => (
                  <OptionButton
                    key={role.id}
                    label={role.label}
                    hint={role.examples}
                    onClick={() => chooseJob(role.id, role.label)}
                  />
                ))}
              </div>
            </>
          )}

          {step.name === "job-first-aid" && (
            <>
              <QuestionHeading
                title="Do you need First Aid as well as CPR?"
                subtitle="Employers differ on this. If you are not sure, check your job requirement or ask your employer, since the First Aid version costs more and takes longer."
              />
              <div className="flex flex-col gap-3">
                <OptionButton
                  label="Yes, CPR and First Aid"
                  hint="Most childcare, camp, and workplace safety roles require both"
                  onClick={() =>
                    go(
                      {
                        name: "result",
                        recommendation: resolveJobRecommendation(step.roleId, true),
                      },
                      "With First Aid"
                    )
                  }
                />
                <OptionButton
                  label="No, just CPR and AED"
                  onClick={() =>
                    go(
                      {
                        name: "result",
                        recommendation: resolveJobRecommendation(step.roleId, false),
                      },
                      "CPR only"
                    )
                  }
                />
              </div>
            </>
          )}

          {step.name === "personal-training" && (
            <>
              <QuestionHeading title="What would you like to learn?" />
              <div className="flex flex-col gap-3">
                <OptionButton
                  label="CPR and AED"
                  hint="Chest compressions, rescue breaths, and using a defibrillator"
                  onClick={() =>
                    go({ name: "personal-cert", training: "cpr" }, "CPR")
                  }
                />
                <OptionButton
                  label="First Aid"
                  hint="Bleeding, burns, breaks, allergic reactions, and more"
                  onClick={() =>
                    go(
                      { name: "personal-cert", training: "first_aid" },
                      "First Aid"
                    )
                  }
                />
                <OptionButton
                  label="Both"
                  hint="The complete course, CPR and First Aid together"
                  onClick={() =>
                    go({ name: "personal-cert", training: "both" }, "Both")
                  }
                />
              </div>
            </>
          )}

          {step.name === "personal-cert" && (
            <>
              <QuestionHeading
                title="Do you need a certification card?"
                subtitle="Our non-certified classes are taught by the same instructors and cover the same skills, and they cost less. The difference is the AHA card at the end."
              />
              <div className="flex flex-col gap-3">
                <OptionButton
                  label="Yes, I need the AHA card"
                  hint="Choose this if anyone will ask you to prove it"
                  onClick={() =>
                    go(
                      {
                        name: "result",
                        recommendation: resolvePersonalRecommendation(
                          step.training,
                          true
                        ),
                      },
                      "Certified"
                    )
                  }
                />
                <OptionButton
                  label="No, I just want to learn"
                  hint="Lower price, same instructors, no card issued"
                  onClick={() =>
                    go(
                      {
                        name: "result",
                        recommendation: resolvePersonalRecommendation(
                          step.training,
                          false
                        ),
                      },
                      "No card needed"
                    )
                  }
                />
              </div>
            </>
          )}

          {step.name === "result" && (
            <ResultPanel
              recommendation={step.recommendation}
              bySlug={bySlug}
              onRestart={restart}
            />
          )}
        </div>
        </div>

        {/* Footer controls */}
        <div className="flex items-center justify-between gap-4 mt-6">
          {history.length > 1 ? (
            <button
              type="button"
              onClick={back}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-white/90 hover:text-white transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-red-600 dark:focus-visible:ring-offset-red-900 rounded-sm"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back
            </button>
          ) : (
            <span />
          )}

          <Link
            href="/contact"
            className="text-sm text-white/80 hover:text-white transition-colors duration-150"
          >
            Still not sure? Send us a message
          </Link>
        </div>
      </div>
    </main>
  );
}

// ── Result ──────────────────────────────────────────────────────────────────

/**
 * The final screen: the recommended course, whether it has dates, and the one
 * action that follows from that.
 *
 * A recommendation whose class is missing from the catalog (renamed or
 * deactivated since the mapping was written) falls back to the request path
 * rather than rendering a broken card. The unit invariant is what is supposed to
 * catch that before a visitor ever sees it.
 *
 * @param recommendation - Outcome of the walkthrough.
 * @param bySlug - Active classes keyed by slug.
 * @param onRestart - Clears the walkthrough and returns to question one.
 */
function ResultPanel({
  recommendation,
  bySlug,
  onRestart,
}: {
  recommendation: Recommendation;
  bySlug: Map<string, FinderClassOption>;
  onRestart: () => void;
}): React.ReactElement {
  /**
   * Returns the first candidate slug that exists in the live catalog.
   * @param candidates - Slugs in priority order.
   * @returns The matching class, or null when none of them are active.
   */
  function resolve(candidates: string[]): FinderClassOption | null {
    for (const slug of candidates) {
      const match = bySlug.get(slug);
      if (match) return match;
    }
    return null;
  }

  const primary = resolve(recommendation.primaryCandidates);

  const alternates = recommendation.alternates
    .map((alt) => ({ alt, option: resolve(alt.candidates) }))
    .filter(
      (
        entry
      ): entry is {
        alt: (typeof recommendation.alternates)[number];
        option: FinderClassOption;
      } => entry.option !== null
    );

  // No matching class: the honest answer is a request, not a guess.
  if (!primary) {
    return (
      <>
        <p className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 mb-2">
          What we recommend
        </p>
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white text-balance mb-3">
          Let us set this up with you
        </h2>
        <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
          {recommendation.rationale}
        </p>
        <Link href="/request-class" className={PRIMARY_BUTTON}>
          Request a class
        </Link>
        <RestartRow onRestart={onRestart} />
      </>
    );
  }

  const hasDates = primary.upcomingCount > 0;

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 mb-2">
        What we recommend
      </p>
      <h2 className="text-2xl font-semibold text-gray-900 dark:text-white text-balance">
        {primary.name}
      </h2>

      <div className="flex flex-wrap gap-2 mt-3">
        {hasDates ? (
          <span className="inline-flex items-center gap-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-semibold px-3 py-1 rounded-full">
            <CalendarCheck size={13} aria-hidden="true" />
            Open now
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-semibold px-3 py-1 rounded-full">
            <MailQuestion size={13} aria-hidden="true" />
            By request
          </span>
        )}
        {primary.isAha && (
          <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs font-semibold px-3 py-1 rounded-full">
            AHA Certified
          </span>
        )}
        <span className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium px-3 py-1 rounded-full">
          {formatDuration(primary.durationMinutes)}
        </span>
        <span className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium px-3 py-1 rounded-full">
          {formatPrice(primary.price)} per person
        </span>
      </div>

      <p className="text-gray-600 dark:text-gray-400 leading-relaxed mt-4">
        {recommendation.rationale}
      </p>

      {primary.description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mt-3">
          {primary.description}
        </p>
      )}

      <div
        className={`mt-6 rounded-xl p-5 ${
          hasDates
            ? "bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900"
            : "bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700"
        }`}
      >
        {hasDates ? (
          <>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              Spots are open. Pick a date that works for you.
            </p>
            <Link href={`/book?class=${primary.slug}`} className={PRIMARY_BUTTON}>
              See dates and book
            </Link>
          </>
        ) : (
          <>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              No classes are currently scheduled. Request this class and we will
              contact you within 24 hours.
            </p>
            <Link
              href={`/request-class?class=${primary.slug}`}
              className={PRIMARY_BUTTON}
            >
              Request this class
            </Link>
          </>
        )}
      </div>

      {alternates.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
            Also worth considering
          </h3>
          <div className="flex flex-col gap-3">
            {alternates.map(({ alt, option }) => (
              <div
                key={option.id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-gray-900 dark:text-white text-sm">
                    {option.name}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {formatPrice(option.price)}
                  </span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mt-1">
                  {alt.reason}
                </p>
                <div className="mt-2">
                  <Link
                    href={
                      option.upcomingCount > 0
                        ? `/book?class=${option.slug}`
                        : `/request-class?class=${option.slug}`
                    }
                    className="text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors duration-150"
                  >
                    {option.upcomingCount > 0
                      ? "See dates"
                      : "Request this class"}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <RestartRow onRestart={onRestart} />
    </>
  );
}

/**
 * The "start over" control shown under every result.
 * @param onRestart - Clears the walkthrough.
 */
function RestartRow({
  onRestart,
}: {
  onRestart: () => void;
}): React.ReactElement {
  return (
    <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
      <button
        type="button"
        onClick={onRestart}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 rounded-sm"
      >
        <RotateCcw size={15} aria-hidden="true" />
        Start over
      </button>
    </div>
  );
}
