/**
 * Walkthrough steps for the "Submit a Class Session for Approval" tour.
 * Used by: CreateSessionClient.tsx, via components/tours/TourButton.tsx.
 * Registered in: lib/tours/registry.ts (id: "create-session").
 * Targets the `data-tour="..."` attributes added to the instructor-only
 * required fields, plus Discount and Add-ons, in CreateSessionClient.tsx.
 * Skips Notes and team-booking mode to keep the walkthrough to the fields
 * that matter for getting a session submitted.
 */

import type { DriveStep } from "driver.js";

export const CREATE_SESSION_STEPS: DriveStep[] = [
  {
    element: '[data-tour="session-class-type"]',
    popover: {
      title: "Pick a Class Type",
      description:
        "Choose what kind of class you're teaching. This also fills in a suggested duration and class size for you.",
    },
  },
  {
    element: '[data-tour="session-instructor"]',
    popover: {
      title: "You're the Instructor",
      description: "This is filled in automatically with your name. Nothing to do here.",
    },
  },
  {
    element: '[data-tour="session-location"]',
    popover: {
      title: "Choose a Location",
      description:
        "Select where the class will be held. Don't see it listed? Use the + Add Location button.",
    },
  },
  {
    element: '[data-tour="session-date"]',
    popover: {
      title: "Set the Date",
      description: "Pick the date your class will take place.",
    },
  },
  {
    element: '[data-tour="session-start-time"]',
    popover: {
      title: "Set the Start Time",
      description: "Enter what time the class starts.",
    },
  },
  {
    element: '[data-tour="session-duration"]',
    popover: {
      title: "Confirm the Duration",
      description:
        "This was filled in based on the class type. Adjust it if your class runs longer or shorter.",
    },
  },
  {
    element: '[data-tour="session-capacity"]',
    popover: {
      title: "Confirm Max Capacity",
      description:
        "This is how many students can sign up. It's filled in automatically, but you can change it.",
    },
  },
  {
    element: '[data-tour="session-discount"]',
    popover: {
      title: "Add a Discount (Optional)",
      description:
        "Want to offer a discount? Pick one of the quick options or enter a custom amount. Leave this blank if there isn't one.",
    },
  },
  {
    // Only rendered once a class type with eligible add-ons is selected, so
    // it may not exist in the DOM yet; skip this step instead of erroring.
    element: '[data-tour="session-addons"]',
    skipMissingElement: true,
    popover: {
      title: "Choose Add-ons (Optional)",
      description:
        "If this class type has any optional add-ons, choose which ones students can purchase for this session.",
    },
  },
  {
    element: '[data-tour="session-submit"]',
    popover: {
      title: "Submit for Approval",
      description:
        "When everything looks right, click here. Your session goes to a manager for approval before it shows up on the public schedule.",
    },
  },
];
