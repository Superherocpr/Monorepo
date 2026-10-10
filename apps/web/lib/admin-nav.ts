/**
 * Admin sidebar navigation: the item list and the per-role section grouping.
 * Used by: app/(admin)/_components/AdminSidebar.tsx
 *
 * Section headers belong to the SECTION, not to its first item. They used to be
 * attached to one item each (Blog carried "Engagement", Analytics carried
 * "Management"), so any role that couldn't see that item lost the header and
 * the items below it fell under whatever section came before. For managers,
 * Contact, Directory and Settings ended up under "Financial". getVisibleNavItems
 * derives each header from the items a role can actually see.
 */

import type { UserRole } from "@/types/users";
import { TEACHING_ROLES } from "@/lib/auth/view-as-constants";

/** One sidebar link. */
export interface NavItem {
  label: string;
  /** Link target. May carry a query string (e.g. "?mine=1"); active-state matching honors it. */
  href: string;
  roles: readonly UserRole[];
  /** Section this item belongs to. Omit for items that sit above all sections (Dashboard). */
  section?: string;
  /**
   * Per-role override of `section`. `null` means the role sees this item with no
   * section header, which keeps the instructor and inspector menus flat.
   */
  sectionByRole?: Partial<Record<UserRole, string | null>>;
  /** Optional sub-group label rendered above this item, nested within a section. */
  subLabel?: string;
  /** When true, indents this item to show it belongs to the preceding subLabel group. */
  nested?: boolean;
}

/** A nav item as one role sees it, with the section header to draw above it (if any). */
export interface VisibleNavItem extends NavItem {
  /** Section header to render above this item. Set only on the first item of each section. */
  sectionHeader: string | null;
}

/** Instructors and inspectors have short menus, so they get no section headers. */
const FLAT_FOR_PLAIN_ROLES = { instructor: null, inspector: null } as const;

/**
 * Full nav config, in display order. Items of one section must be contiguous.
 * Items are filtered to the viewer's role at render time.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/admin",
    roles: ["instructor", "manager", "super_admin", "inspector"],
  },

  // ── My Teaching ────────────────────────────────────────────────────────────
  // Everything a teaching role needs for the classes they teach themselves. An
  // instructor's sessions list is already scoped to their own classes; managers
  // and super admins see every class there, so their link carries ?mine=1.
  { label: "My Class Sessions", href: "/admin/sessions", roles: ["instructor"] },
  {
    label: "My Class Sessions",
    href: "/admin/sessions?mine=1",
    roles: ["manager", "super_admin"],
    section: "My Teaching",
  },
  {
    label: "Rollcall",
    href: "/rollcall",
    roles: TEACHING_ROLES,
    section: "My Teaching",
    sectionByRole: FLAT_FOR_PLAIN_ROLES,
  },
  {
    label: "Payout Settings",
    href: "/admin/profile/payment",
    roles: ["manager", "super_admin"],
    section: "My Teaching",
  },

  // ── Operations ─────────────────────────────────────────────────────────────
  {
    label: "Class Sessions",
    href: "/admin/sessions",
    roles: ["manager", "super_admin"],
    section: "Operations",
  },
  {
    label: "Customers",
    href: "/admin/customers",
    roles: ["manager", "super_admin"],
    section: "Operations",
  },
  {
    label: "Contact",
    href: "/admin/contact",
    roles: ["manager", "super_admin"],
    section: "Operations",
  },
  {
    label: "Customer Requests",
    href: "/admin/class-requests",
    roles: ["manager", "super_admin"],
    section: "Operations",
    subLabel: "Requests",
    nested: true,
  },
  {
    label: "Instructor Requests",
    href: "/admin/sessions/approvals",
    roles: ["manager", "super_admin"],
    section: "Operations",
    nested: true,
  },

  // ── Financial ──────────────────────────────────────────────────────────────
  {
    label: "Invoices",
    href: "/admin/invoices",
    roles: ["manager", "super_admin"],
    section: "Financial",
  },
  {
    label: "Payments",
    href: "/admin/payments",
    roles: ["manager", "super_admin"],
    section: "Financial",
  },
  { label: "Payouts", href: "/admin/payouts", roles: ["super_admin"], section: "Financial" },
  {
    label: "Promo Codes",
    href: "/admin/promo-codes",
    roles: ["super_admin"],
    section: "Financial",
  },

  // ── Engagement (super admin) ───────────────────────────────────────────────
  { label: "Blog", href: "/admin/blog", roles: ["super_admin"], section: "Engagement" },
  {
    label: "Certifications",
    href: "/admin/certifications",
    roles: ["super_admin"],
    section: "Engagement",
  },
  { label: "Merch", href: "/admin/merch", roles: ["super_admin"], section: "Engagement" },
  { label: "Orders", href: "/admin/orders", roles: ["super_admin"], section: "Engagement" },

  // ── Management (super admin) ───────────────────────────────────────────────
  {
    label: "Analytics",
    href: "/admin/analytics",
    roles: ["super_admin"],
    section: "Management",
  },
  {
    label: "Archived Accounts",
    href: "/admin/archived",
    roles: ["super_admin"],
    section: "Management",
  },

  // ── Team ───────────────────────────────────────────────────────────────────
  {
    label: "Directory",
    href: "/admin/directory",
    roles: ["instructor", "manager", "super_admin", "inspector"],
    section: "Team",
    sectionByRole: FLAT_FOR_PLAIN_ROLES,
  },
  {
    label: "Settings",
    href: "/admin/settings",
    roles: ["instructor", "manager", "super_admin"],
    section: "Team",
    sectionByRole: FLAT_FOR_PLAIN_ROLES,
  },
  { label: "Staff", href: "/admin/staff", roles: ["super_admin"], section: "Team" },

  // ── Payroll (instructors only) ─────────────────────────────────────────────
  // Managers and super admins have Payout Settings under My Teaching; instructors
  // keep their original separate Payroll section at the bottom.
  {
    label: "Payout Settings",
    href: "/admin/profile/payment",
    roles: ["instructor"],
    section: "Payroll",
  },
];

/**
 * Resolves the section an item belongs to for one role.
 * @param item - The nav item.
 * @param role - The viewer's effective role.
 * @returns The section name, or null when the role sees this item with no header.
 */
function sectionFor(item: NavItem, role: UserRole): string | null {
  const override = item.sectionByRole?.[role];
  if (override !== undefined) return override;
  return item.section ?? null;
}

/**
 * The nav items a role can see, in display order, each tagged with the section
 * header to draw above it. A header appears on the first visible item of a
 * section, so it is present whenever the role sees anything in that section.
 * @param role - The viewer's effective role.
 * @param items - Nav config to filter; defaults to NAV_ITEMS (parameter exists for tests).
 * @returns Visible items with `sectionHeader` set where a new section begins.
 */
export function getVisibleNavItems(
  role: UserRole,
  items: readonly NavItem[] = NAV_ITEMS
): VisibleNavItem[] {
  let previousSection: string | null = null;
  return items
    .filter((item) => item.roles.includes(role))
    .map((item) => {
      const section = sectionFor(item, role);
      const sectionHeader = section !== null && section !== previousSection ? section : null;
      previousSection = section;
      return { ...item, sectionHeader };
    });
}
