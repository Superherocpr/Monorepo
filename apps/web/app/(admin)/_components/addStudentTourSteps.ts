/**
 * Walkthrough steps for the "Add a Student to a Class" tour.
 * Used by: SessionDetailClient.tsx, via components/tours/TourButton.tsx.
 * Registered in: lib/tours/registry.ts (id: "add-student", all staff).
 *
 * Entry is a two-hop design, not auto-launched: the How-To Guides card
 * links to /admin/sessions (there's no single "right" session to deep-link
 * into), and this tour's TourButton lives on the session detail page for
 * the user to trigger manually once they've clicked into a real session.
 *
 * Demonstrates one golden path (search -> Select -> charge panel), which
 * works for every role, rather than also walking through the manager-only
 * free "Add" shortcut. Managers and super admins (`canAddWithoutCharging`)
 * get one extra step for their "Charge and add to class" / "Charge only"
 * choice, and role-specific copy on the steps whose behavior differs.
 *
 * Ends at the card/Charge step as a highlight-only warning: submitting
 * charges a real card immediately with no second confirmation, so this
 * tour never demonstrates clicking it.
 */

import type { DriveStep } from "driver.js";

/**
 * Builds the Add Student walkthrough steps for the viewer's role.
 * @param canAddWithoutCharging - True for manager/super_admin, who also get
 *   a free "Add" shortcut per search result; false for instructors, whose
 *   only path to a booking is the charge panel.
 */
export function getAddStudentSteps(canAddWithoutCharging: boolean): DriveStep[] {
  return [
    {
      element: '[data-tour="add-student-button"]',
      popover: {
        title: "Add a Student",
        description: "Click here to search for a student and add them to this class.",
      },
    },
    {
      element: '[data-tour="add-student-search"]',
      popover: {
        title: "Search for the Student",
        description: "Type their name, email, or phone number to find them.",
      },
    },
    {
      element: '[data-tour="add-student-results"]',
      popover: {
        title: "Pick the Student",
        description: canAddWithoutCharging
          ? "Find them in the list. Click Add to add them for free with no charge, or Select to charge their card."
          : "Find them in the list and click Select. They're only added once the charge below goes through.",
      },
    },
    {
      element: '[data-tour="add-student-amount"]',
      popover: {
        title: "Confirm the Amount",
        description: canAddWithoutCharging
          ? "This is pre-filled from the class price. Adjust it if needed, or leave this panel alone if you used the free Add button instead."
          : "This is pre-filled from the class price. Adjust it if needed before charging.",
      },
    },
    ...(canAddWithoutCharging
      ? [
          {
            element: '[data-tour="add-student-mode"]',
            popover: {
              title: "Choose What the Charge Does",
              description:
                "Charge and add to class takes the payment and adds the student in one step, and refunds automatically if they can't be added. Charge only records the payment without adding them.",
            },
          },
        ]
      : []),
    {
      element: '[data-tour="add-student-description"]',
      popover: {
        title: "Add a Description (Optional)",
        description: "A short label for this charge, like \"Manual register charge.\"",
      },
    },
    {
      element: '[data-tour="add-student-notes"]',
      popover: {
        title: "Add Notes (Optional)",
        description: "Any internal note about this charge.",
      },
    },
    {
      element: '[data-tour="add-student-payment"]',
      popover: {
        title: "Enter Card & Charge",
        description: canAddWithoutCharging
          ? "Enter the card, then click Charge. This charges immediately with no second confirmation. With Charge and add to class, the student is added only if it succeeds; with Charge only, they are not added. Double check the amount first."
          : "Enter the card, then click Charge. This charges immediately with no second confirmation, and only adds the student if it succeeds. Double check the amount first.",
      },
    },
  ];
}
