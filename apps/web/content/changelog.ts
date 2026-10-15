/**
 * The staff "What's New" changelog: every change worth telling staff about.
 * Shown at /admin/whats-new, with an unread count in the admin sidebar.
 *
 * HOW TO ADD AN ENTRY (CLAUDE.md rule 14): when a user-visible feature or
 * behavior change lands on staging, add an entry at the TOP of this list in
 * the same task, under the version you are bumping to (rule 13).
 *  - Write for the person using the admin, not for developers: what changed and
 *    what they can now do. No jargon, no file names, no em dashes (rule 11).
 *  - Set `roles` when only some staff care (omit it for everyone).
 *  - Every entry of one version shares one `date`; `title` is unique per version.
 *  - Pure fixes and internal work with no visible effect do not need an entry.
 * tests/unit/lib/changelog.test.ts enforces ordering, format, and that a new
 * minor or major version in package.json has an entry.
 *
 * Versions before 1.8.0 were reconstructed from git history: each entry is filed
 * under the first version bump at or after the work landed.
 */

import type { ChangelogEntry } from "@/types/changelog";

export const CHANGELOG: readonly ChangelogEntry[] = [
  // ── 1.8.0 ──────────────────────────────────────────────────────────────────
  {
    version: "1.8.0",
    date: "2026-10-15",
    kind: "new",
    title: "What's New page",
    summary:
      "This page. Whenever a feature is added or something changes in a way that matters to you, it is listed here under the version number shown at the bottom of the sidebar. A number beside What's New in the menu tells you how many entries you have not read yet.",
    href: "/admin/whats-new",
  },

  // ── 1.7.0 ──────────────────────────────────────────────────────────────────
  {
    version: "1.7.0",
    date: "2026-10-15",
    kind: "new",
    title: "Pay only the instructors you choose",
    summary:
      "On the Payouts page you can now tick the instructors or classes you want to pay, review the total, and confirm. Only the ones you picked are sent. Pay all is still there when you want everyone.",
    roles: ["super_admin"],
    href: "/admin/payouts",
  },
  {
    version: "1.7.0",
    date: "2026-10-15",
    kind: "new",
    title: "Invoices record how they were paid and what it cost",
    summary:
      "Marking an invoice paid now asks how the money came in. Check, cash and other methods are recorded with no fee. For PayPal payments the collection fee is read from PayPal and shown on the invoice.",
    roles: ["manager", "super_admin"],
    href: "/admin/invoices",
  },

  // ── 1.6.0 ──────────────────────────────────────────────────────────────────
  {
    version: "1.6.0",
    date: "2026-10-12",
    kind: "improved",
    title: "Students can sign up until the class ends",
    summary:
      "The booking cutoff moved from the class start time to the class end time. A student who arrives late, or decides after it begins, can still book while the class is running. The messaging on the booking pages was updated to match.",
  },
  {
    version: "1.6.0",
    date: "2026-10-12",
    kind: "improved",
    title: "Partly paid badge on payout batches",
    summary:
      "A payout batch where some instructors were paid and PayPal sent others back now shows Partly paid instead of Confirmed paid. The returned ones stay in the payable queue so you can retry them.",
    roles: ["super_admin"],
    href: "/admin/payouts",
  },

  // ── 1.5.0 ──────────────────────────────────────────────────────────────────
  {
    version: "1.5.0",
    date: "2026-10-10",
    kind: "new",
    title: "Dark mode for the admin area",
    summary:
      "Choose Light, Dark, or System under Settings, or use the sun and moon button in the top bar. It is saved on the device you are using and never changes the public website or the student check-in screen.",
    href: "/admin/settings",
  },
  {
    version: "1.5.0",
    date: "2026-10-10",
    kind: "fixed",
    title: "Sidebar sections match your role",
    summary:
      "Managers used to see Contact, Directory and Settings listed under Financial. Each role now gets its own correctly labeled sections.",
    roles: ["manager"],
  },

  // ── 1.4.1 ──────────────────────────────────────────────────────────────────
  {
    version: "1.4.1",
    date: "2026-10-07",
    kind: "improved",
    title: "Contact form: Instructor inquiries",
    summary:
      "The Hiring option on the public contact form is now Instructor, for people who want to teach with us. Past submissions that used Hiring now read as Instructor.",
    roles: ["manager", "super_admin"],
    href: "/admin/contact",
  },

  // ── 1.4.0 ──────────────────────────────────────────────────────────────────
  {
    version: "1.4.0",
    date: "2026-10-07",
    kind: "new",
    title: "Paid manually payouts",
    summary:
      "PayPal has been declining payouts, so you can now pay an instructor yourself and record it as Paid manually. If you record one by mistake, Undo (with a reason) puts the earnings back in the payable queue.",
    roles: ["super_admin"],
    href: "/admin/payouts",
  },
  {
    version: "1.4.0",
    date: "2026-10-07",
    kind: "new",
    title: "Staff Directory",
    summary:
      "A new page with every active staff member's name, role, phone and email, plus the class types each instructor has taught. Click a phone number to call or an email to write. Super admins can set a different directory phone or email for someone, or hide test accounts.",
    href: "/admin/directory",
  },
  {
    version: "1.4.0",
    date: "2026-10-07",
    kind: "improved",
    title: "Managers get every instructor tool",
    summary:
      "Managers can now do everything an instructor can for the classes they teach themselves: rollcall, grading, class invoices and payouts. Their own rollcall code also shows on the manager dashboard.",
    roles: ["manager"],
    href: "/admin",
  },
  {
    version: "1.4.0",
    date: "2026-10-07",
    kind: "fixed",
    title: "Class discount now applies to team rates",
    summary:
      "If you set a discount percent on a team booking class, it was being ignored. It is now taken off the team's per-seat rate, and the signup link and checkout show and charge the same discounted price.",
    roles: ["manager", "super_admin"],
  },
  {
    version: "1.4.0",
    date: "2026-10-07",
    kind: "improved",
    title: "Payout email reminder when changing a role",
    summary:
      "When you change someone's role to one that teaches, Staff Management reminds you that they need to add their PayPal payout email before they can be paid.",
    roles: ["super_admin"],
    href: "/admin/staff",
  },

  // ── 1.3.0 ──────────────────────────────────────────────────────────────────
  {
    version: "1.3.0",
    date: "2026-09-17",
    kind: "new",
    title: "Guided walkthroughs",
    summary:
      "Step-by-step tours that highlight each button as you go. There are walkthroughs for creating a class, setting up a team booking, and adding a student to a class. Start one from the Tour button on the page, or from the How-To Guides tab.",
  },

  // ── 1.2.5 ──────────────────────────────────────────────────────────────────
  {
    version: "1.2.5",
    date: "2026-09-15",
    kind: "fixed",
    title: "No unclaimed-class alerts for empty classes",
    summary:
      "The reminder that a class still needs an instructor was also firing for classes with nobody signed up. It now skips those.",
    roles: ["manager", "super_admin"],
  },

  // ── 1.2.4 ──────────────────────────────────────────────────────────────────
  {
    version: "1.2.4",
    date: "2026-09-14",
    kind: "fixed",
    title: "Daily summary email is more reliable",
    summary:
      "The morning digest of what happened in the business now still goes out if looking up one of its recipients fails.",
    roles: ["manager", "super_admin"],
  },

  // ── 1.2.3 ──────────────────────────────────────────────────────────────────
  {
    version: "1.2.3",
    date: "2026-09-12",
    kind: "fixed",
    title: "Scheduled jobs log the real reason they failed",
    summary:
      "When a behind-the-scenes job such as the social feed refresh fails, the log now records the actual error instead of only a status code. You will not notice a change unless one breaks.",
    roles: ["super_admin"],
  },

  // ── 1.2.2 ──────────────────────────────────────────────────────────────────
  {
    version: "1.2.2",
    date: "2026-09-08",
    kind: "improved",
    title: "Home page sends visitors through Find a Class",
    summary:
      "The main buttons on the public home page now lead into the guided class finder first, so new visitors are matched to the right course before they see the schedule.",
  },

  // ── 1.2.0 ──────────────────────────────────────────────────────────────────
  {
    version: "1.2.0",
    date: "2026-09-08",
    kind: "new",
    title: "Home base venue for class requests",
    summary:
      "People requesting a class can now pick one of your home base locations as the venue, with no travel fee. When you approve the request, the existing location is reused instead of creating a duplicate. Mark a location as a home base under Settings, Locations.",
    roles: ["manager", "super_admin"],
    href: "/admin/class-requests",
  },

  // ── 1.1.0 ──────────────────────────────────────────────────────────────────
  {
    version: "1.1.0",
    date: "2026-09-08",
    kind: "new",
    title: "Guided class finder on the public site",
    summary:
      "Find a Class is a short set of questions that recommends the right course and shows which dates are open. It helps new customers who do not know whether they need BLS, ACLS, or something else.",
  },

  // ── 1.0.0 ──────────────────────────────────────────────────────────────────
  {
    version: "1.0.0",
    date: "2026-09-07",
    kind: "new",
    title: "Version number in the sidebar",
    summary:
      "The bottom of the sidebar now shows the exact version of the site you are using. Quote it when you report a bug or a problem, so we know which build you were on.",
  },
  {
    version: "1.0.0",
    date: "2026-09-07",
    kind: "improved",
    title: "Team bookings: bill per signup, automatic share link",
    summary:
      "A company can now be billed per signup instead of one flat price. The signup link is emailed to the company contact as soon as you approve the booking. Team classes can also be edited at any time, and everyone already signed up is notified of the change instead of the class being sent back for approval.",
    roles: ["manager", "super_admin"],
    href: "/admin/sessions",
  },
];
