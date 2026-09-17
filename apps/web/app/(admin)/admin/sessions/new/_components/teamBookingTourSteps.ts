/**
 * Walkthrough steps for the "Create a Team or Corporate Booking" tour.
 * Used by: CreateSessionClient.tsx, via components/tours/TourButton.tsx.
 * Registered in: lib/tours/registry.ts (id: "team-booking", all staff).
 * Reuses the shared fields from tourSteps.ts that behave identically in
 * team mode (Class Type, Instructor, Location, Date, Start Time, Duration,
 * Max Capacity, Discount) — including both INSTRUCTOR_STEP and
 * INSTRUCTOR_SELECT_STEP, since this tour is open to all three roles and
 * each targets a different role's version of that field; adds team-specific
 * steps for the company details, payment mode, and price; and ends at the
 * real confirmation modal's "Yes, create it" button rather than the
 * post-submit success screen, since reaching that reliably would require
 * bridging the async gap of a real network request that also sends a real
 * email.
 */

import type { DriveStep } from "driver.js";
import {
  CLASS_TYPE_STEP,
  INSTRUCTOR_STEP,
  INSTRUCTOR_SELECT_STEP,
  LOCATION_STEP,
  DATE_STEP,
  START_TIME_STEP,
  DURATION_STEP,
  CAPACITY_STEP,
  DISCOUNT_STEP,
} from "./tourSteps";

export const TEAM_BOOKING_STEPS: DriveStep[] = [
  {
    element: '[data-tour="team-toggle"]',
    popover: {
      title: "Team Booking Mode",
      description:
        "This box is already checked since you started this walkthrough. Uncheck it any time to switch back to a regular class.",
    },
  },
  {
    element: '[data-tour="team-company"]',
    popover: {
      title: "Company Name",
      description: "Enter the name of the business or organization booking this class.",
    },
  },
  {
    element: '[data-tour="team-contact-name"]',
    popover: {
      title: "Contact Name",
      description: "Enter the name of the person you've been in touch with at the company.",
    },
  },
  {
    element: '[data-tour="team-contact-phone"]',
    popover: {
      title: "Contact Phone",
      description: "Enter their phone number.",
    },
  },
  {
    element: '[data-tour="team-contact-email"]',
    popover: {
      title: "Contact Email",
      description: "This is where the signup link and invoice will be sent.",
    },
  },
  {
    element: '[data-tour="team-payment-mode"]',
    popover: {
      title: "Choose Who Pays",
      description:
        "Pick whether each employee pays when they sign up, or the company is billed instead.",
    },
  },
  {
    element: '[data-tour="team-price"]',
    popover: {
      title: "Set the Price",
      description:
        "Enter the amount here. The label above changes depending on who's paying, but this is always where you enter it.",
    },
  },
  CLASS_TYPE_STEP,
  INSTRUCTOR_STEP,
  INSTRUCTOR_SELECT_STEP,
  LOCATION_STEP,
  DATE_STEP,
  START_TIME_STEP,
  DURATION_STEP,
  CAPACITY_STEP,
  DISCOUNT_STEP,
  {
    element: '[data-tour="session-submit"]',
    popover: {
      title: "Continue",
      description:
        "Click here to review your booking. Since this is a team booking, one more confirmation screen appears before anything is sent.",
    },
  },
  {
    element: '[data-tour="team-confirm-submit"]',
    popover: {
      title: "This Sends It",
      description:
        "Clicking \"Yes, create it\" is final. It creates the booking and, per the message above, may email the contact right away. Only click it when you're ready.",
    },
  },
];
