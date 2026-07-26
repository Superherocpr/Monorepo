/**
 * Static content data for the Admin Feature Reference page.
 * Used by: /admin/reference (ReferenceContent client component)
 * Update this file whenever admin pages or features change — see rule §5 in CLAUDE.md.
 */

export type RoleKey = "super" | "manager" | "all" | "instructor";

/** A single bullet point — either plain text (visible to anyone who can see the section)
 *  or a role-gated object (only shown to users who meet that role requirement). */
export type Bullet = string | { text: string; role: RoleKey };

export const ROLE_LABELS: Record<RoleKey, string> = {
  super: "Super Admin",
  manager: "Manager+",
  all: "All Staff",
  instructor: "Instructor+",
};

export const ROLE_CLASSES: Record<RoleKey, string> = {
  super: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  manager: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  all: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  instructor: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

export interface SectionDef {
  id: string;
  name: string;
  url: string;
  role: RoleKey;
  bullets: Bullet[];
}

export interface GroupDef {
  id: string;
  label: string;
  sections: SectionDef[];
}

export const GROUPS: GroupDef[] = [
  {
    id: "sessions",
    label: "Sessions",
    sections: [
      {
        id: "sessions-list",
        name: "Sessions List",
        url: "/admin/sessions",
        role: "all",
        bullets: [
          "View all scheduled class sessions, grouped and sorted by month",
          "Filter by date range, class type, and approval status",
          { text: "Filter by instructor", role: "manager" },
          "Session cards show status badges, spots remaining, instructor, and location at a glance",
          "Jump directly to New Session, Bulk Create, or the Approvals Queue from this page",
        ],
      },
      {
        id: "sessions-new",
        name: "New Session",
        url: "/admin/sessions/new",
        role: "all",
        bullets: [
          "Create a single class session — pick class type, location, date/time, and max capacity",
          "Set a discount percent or travel fee for the session",
          { text: "Assign an instructor to the session", role: "manager" },
          "Attach eligible add-ons from a checklist automatically filtered to the chosen class type",
          "Submission routes the session to the approvals queue for manager review before it goes live",
        ],
      },
      {
        id: "sessions-bulk",
        name: "Bulk Session Create",
        url: "/admin/sessions/bulk",
        role: "all",
        bullets: [
          "Create many sessions at once by selecting multiple dates with a single set of shared settings",
          "Set class type, location, instructor, and capacity once — applies to every date selected",
          "Saves time when scheduling recurring weekly or monthly classes",
          { text: "Assign any instructor to all sessions in the batch", role: "manager" },
        ],
      },
      {
        id: "sessions-approvals",
        name: "Approvals Queue",
        url: "/admin/sessions/approvals",
        role: "manager",
        bullets: [
          "Review all sessions waiting for approval before they appear on the public schedule",
          "Approve individual sessions or use Approve All to clear the queue in one click",
          "Reject a session with a written reason — it returns to the instructor for corrections",
          "Resubmitted (previously rejected) sessions are highlighted at the top of the queue",
          "A badge in the header shows the live count of pending approvals",
        ],
      },
    ],
  },
  {
    id: "within-a-session",
    label: "Within a Session",
    sections: [
      {
        id: "session-detail",
        name: "Session Detail",
        url: "/admin/sessions/[id]",
        role: "all",
        bullets: [
          "Edit session fields — class type, location, instructor, assistant instructor, date/time, capacity, discount, travel fee, and notes",
          { text: "Approve or reject the session with a reason", role: "manager" },
          "Add or remove add-ons and manage per-add-on pricing",
          "Cancel the session — blocked within 48 hours (prompts to call Daniel instead)",
          "Submit to Enrollware — marks the session as submitted to the Enrollware platform",
          "Export student list as a CSV file",
          "View a combined student table of all bookings and imported roster records, deduplicated by email",
          "Edit customer contact info directly from this page via a modal",
          "Send Invoice — opens the invoice creation form pre-filled with this session",
          "Log a payment for a student manually",
          "View all invoices linked to this session and their current status",
          "View roster upload history and any pending customer-submitted roster files",
        ],
      },
      {
        id: "session-roster",
        name: "Roster Import",
        url: "/admin/sessions/[id]/roster",
        role: "manager",
        bullets: [
          "Upload a CSV file to import a student roster for the session",
          "Walks through a 4-step flow: upload → parse → review → confirm",
          "Duplicate detection — flags any email that already exists on the roster",
          "Review and de-select individual rows before confirming the import",
          "A banner appears if the customer has submitted their own roster file for this session",
        ],
      },
      {
        id: "session-checkin",
        name: "Check-in / Rollcall Display",
        url: "/admin/sessions/[id]/checkin",
        role: "instructor",
        bullets: [
          "Generates a daily QR code designed to be projected on screen for students to scan and check in",
          "Shows a live-updating list of students who have successfully verified their attendance",
          "Codes are valid for the current business day — prompts to refresh if yesterday's code is loaded",
          "Session header displays class type, location, and time for easy reference at the front of the room",
        ],
      },
      {
        id: "session-grades",
        name: "Grading Tool",
        url: "/admin/sessions/[id]/grades",
        role: "instructor",
        bullets: [
          "Assign a grade to each student on the session roster using one-click preset grade buttons",
          "Preset grade options are configurable in Settings — only options valid for this class type appear",
          "Optionally record a CCF compression score per student",
          "Student list is sorted by last name for easy reference against a physical roster",
        ],
      },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    sections: [
      {
        id: "customers-list",
        name: "Customers List",
        url: "/admin/customers",
        role: "manager",
        bullets: [
          "Search customers by name or email — results update live as you type",
          "Filter by certification status (active, expiring, expired), booking activity, and account status",
          "Table shows: name, email, phone, upcoming and total bookings, active certifications, and account age",
          "Create a new customer from a slide-in panel — sends them a setup email automatically",
          "Click any row to open the full Customer Detail page",
        ],
      },
      {
        id: "customer-detail",
        name: "Customer Detail",
        url: "/admin/customers/[id]",
        role: "manager",
        bullets: [
          "Edit profile fields inline — name, email, phone, and address; changes save immediately",
          "Archive or unarchive the customer account",
          "Bookings tab — view upcoming, past, and cancelled bookings; add a new booking; cancel a booking with a reason",
          "Certifications tab — issue a new certification (type, dates, cert number, notes); edit or delete existing certs",
          "Orders tab — view merch orders; update order status; add a tracking number",
          "Payments tab — view full payment history including PayPal transaction IDs; log a manual payment",
          "Notes tab — write and save internal staff notes visible only in admin; auto-saves on blur",
        ],
      },
      {
        id: "archived",
        name: "Archived Accounts",
        url: "/admin/archived",
        role: "super",
        bullets: [
          "View all customers who have been archived, with their archive date, booking count, cert count, and order count",
          "Search archived accounts by name or email",
          "Restore an account — re-enables the customer's login and removes the archived status",
          "Confirm step prevents accidental restores",
        ],
      },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    sections: [
      {
        id: "payments",
        name: "Payments",
        url: "/admin/payments",
        role: "manager",
        bullets: [
          "View all payments across the platform — 50 records per page with pagination",
          "Filter by payment type (online, cash, check, deposit, invoice), status, date range, customer, and instructor",
          "Summary strip at the top shows the current month's total online + invoice revenue and total cash/check/deposit revenue",
          "Table columns: customer, session, instructor, payment type, status, amount, date, and who logged it",
        ],
      },
      {
        id: "invoices",
        name: "Invoices",
        url: "/admin/invoices",
        role: "all",
        bullets: [
          "View all invoices with columns for invoice number, recipient, company, session, student count, amount, and status",
          "Filter by status (sent, paid, cancelled), invoice type (individual or group), date range, and class type",
          { text: "Filter by instructor", role: "manager" },
          { text: "Instructors see only their own invoices", role: "manager" },
          "Button to create a new invoice at the top of the page",
        ],
      },
      {
        id: "invoice-create",
        name: "Create Invoice",
        url: "/admin/invoices/new",
        role: "instructor",
        bullets: [
          { text: "Super admins first select the instructor, then choose a session from their list", role: "super" },
          "Set invoice type (individual or group), recipient name, company, email, and student count",
          "Optionally override the price per student",
          "Session picker shows remaining spots — capacity accounts for existing bookings and unpaid invoice students",
          "Instructors who haven't set a PayPal payout email are redirected to profile settings before proceeding",
          "Can be pre-filled from the Session Detail page via the Send Invoice button",
        ],
      },
      {
        id: "invoice-detail",
        name: "Invoice Detail",
        url: "/admin/invoices/[id]",
        role: "all",
        bullets: [
          "View invoice header: number, status badge, class/session, location, recipient, student count, and total amount",
          { text: "Mark as paid", role: "super" },
          { text: "Resend the invoice email to the recipient", role: "super" },
          { text: "Cancel the invoice", role: "super" },
          "Full activity log timeline — every action on the invoice with actor name and timestamp",
        ],
      },
      {
        id: "payouts",
        name: "Payouts",
        url: "/admin/payouts",
        role: "super",
        bullets: [
          "View all pending instructor earnings grouped by instructor — gross amount, platform fee, and net payout",
          "Warns when an instructor is missing a PayPal email (their earnings can't be paid out)",
          "Send Payout Batch — submits all eligible pending earnings to PayPal in one batch",
          "Sync PayPal status — refreshes the status of submitted batches from PayPal's API",
          "View the last 20 payout batches with status badges (sent, completed, failed), amounts, and timestamps",
          "Release a failed batch after confirming with PayPal outside the system",
        ],
      },
      {
        id: "promo-codes",
        name: "Promo Codes",
        url: "/admin/promo-codes",
        role: "super",
        bullets: [
          "Create a promo code — set the code string, discount type (fixed dollar, percent off, or free), value, and expiry date",
          "Toggle a code active or inactive without deleting it",
          "Scope a code to all sessions, specific class types, or specific individual sessions",
          "Edit or delete any existing code",
          "List view shows code, discount details, expiry, active status, and scope at a glance",
        ],
      },
    ],
  },
  {
    id: "merchandise",
    label: "Merchandise",
    sections: [
      {
        id: "merch",
        name: "Merch Management",
        url: "/admin/merch",
        role: "super",
        bullets: [
          "Add a product — name, description, price, image (uploads to S3), size variants with initial stock quantities, and a low-stock threshold",
          "Edit an existing product's details or replace its image",
          "Activate or deactivate a product to show or hide it from the public store",
          "Adjust stock per size variant from a dedicated slide-in panel — edit each size's quantity individually",
          "Low-stock warnings appear when a variant falls below the configured threshold",
        ],
      },
      {
        id: "orders",
        name: "Orders",
        url: "/admin/orders",
        role: "super",
        bullets: [
          "View all merchandise orders — 50 per page with pagination",
          "Filter by order status (pending, paid, shipped, delivered, cancelled), date range, and customer name/email",
          "Order rows show: customer, items with size and quantity, total, status, shipping info, and tracking number",
          "Update order status and add a tracking number inline from the list view",
        ],
      },
    ],
  },
  {
    id: "people",
    label: "People",
    sections: [
      {
        id: "staff",
        name: "Staff Management",
        url: "/admin/staff",
        role: "super",
        bullets: [
          "Invite a new staff member via a slide-in panel — enter their name, email, and role (Instructor, Manager, Super Admin, or Inspector)",
          "Change role for any existing staff member",
          "Deactivate an account to revoke login access, or reactivate a deactivated account",
          "Edit instructor bio — photo, description, credentials, and published/unpublished toggle for the public About page",
          "Filter the list by status (active/deactivated) and role; search by name",
          "Owner accounts are protected — no action buttons shown for them",
        ],
      },
    ],
  },
  {
    id: "content",
    label: "Content & Outreach",
    sections: [
      {
        id: "blog",
        name: "Blog Posts",
        url: "/admin/blog",
        role: "super",
        bullets: [
          "View all blog posts with title, slug, tags, publish status (Draft / Published), and publish date",
          "Create a new post — full editor with title, slug, body (rich text), excerpt, cover image, SEO fields, target keyword, and tag selector",
          "Edit any existing post — same full editor, pre-populated with current content",
          "Publish or unpublish a post without deleting it",
          "Manage blog tags from a linked Tags page",
        ],
      },
      {
        id: "blog-tags",
        name: "Blog Tags",
        url: "/admin/blog/tags",
        role: "super",
        bullets: [
          "Create a tag — enter a name and a URL slug is auto-generated",
          "Delete a tag — removes it from all posts that use it; shows a confirmation prompt",
          "Tag list shows each tag's name, public URL path (/blog/tag/[slug]), and a delete button",
          "Updates happen without a full page reload",
        ],
      },
      {
        id: "contact",
        name: "Contact Submissions",
        url: "/admin/contact",
        role: "manager",
        bullets: [
          "View all contact form submissions from the public website",
          "Filter by inquiry type, replied status (unanswered / replied), and date range",
          "Unanswered submissions are shown first; a badge in the header shows the unreplied count",
          "Expand any submission to read the full message and reply thread",
          "Reply directly via Zoho Mail from within the admin panel",
          "Mark as replied to move it out of the unanswered queue",
          "Zoho connection status is checked on load — reply button is disabled if Zoho is not connected",
        ],
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    sections: [
      {
        id: "class-requests",
        name: "Class Requests",
        url: "/admin/class-requests",
        role: "manager",
        bullets: [
          "View all private class requests submitted by customers through the public site",
          "Filter by status using tabs — All, Pending, Approved, Instructor Assigned, Rejected",
          "Request cards show: class type, customer name and email, preferred date, venue, group size, travel fee, and submitted date",
          "Pending count badge displayed when viewing the All tab",
          "Click any request to open the full detail view",
        ],
      },
      {
        id: "class-request-detail",
        name: "Class Request Detail",
        url: "/admin/class-requests/[id]",
        role: "manager",
        bullets: [
          "View full request details: class type, customer contact info, preferred date/time, group size, venue address, notes, and travel fee",
          "Approve — automatically creates a linked session from the request data and redirects to it",
          "Reject — requires a written reason (minimum 10 characters); reason is displayed on the record",
          "If already approved, shows a direct link to the created session",
          "Approve and Reject buttons only appear for pending requests",
        ],
      },
      {
        id: "certifications",
        name: "Certifications",
        url: "/admin/certifications",
        role: "super",
        bullets: [
          "Issue a new certification — select customer, cert type, issue date, expiry date, cert number, notes, and optionally link a session",
          "Edit or delete any existing certification",
          "Certifications table shows: customer, cert type, issue/expiry dates, cert number, reminder sent flag, and linked session",
          "Manage cert types — create or edit types with name, description, validity period (months), issuing body, card design, active toggle, and linked class type",
          "Pause or resume cert expiry reminder emails system-wide",
          "A banner appears when reminders are currently paused",
        ],
      },
      {
        id: "enrollware",
        name: "Enrollware Tool",
        url: "/admin/enrollware-tool",
        role: "all",
        bullets: [
          "Shows today's scheduled classes for the logged-in instructor at a glance — class type, time, location, student count, and Enrollware submission status",
          "Generate an Enrollware bookmarklet API key — a personal key that powers the Enrollware browser bookmarklet",
          "Revoke an existing API key if it needs to be reset",
          "Step-by-step instructions for installing the bookmarklet in the browser",
          "The bookmarklet auto-fills Enrollware class forms using data from this system and imports the student roster",
        ],
      },
    ],
  },
  {
    id: "config",
    label: "Data & Configuration",
    sections: [
      {
        id: "analytics",
        name: "Analytics",
        url: "/admin/analytics",
        role: "super",
        bullets: [
          "Choose any custom date range — defaults to the last 90 days",
          "Overview — KPI strip with total revenue, sessions held, and students trained",
          "Revenue charts — revenue over time (line chart), by class type (bar chart), and by instructor for invoice revenue",
          "Classes & Students — enrollment trends, class type activity, and student volume charts",
          "Invoices — invoice volume and value metrics",
          "Merch — merchandise sales charts",
          "Each section is individually collapsible to focus on what matters",
          "Export CSV — downloads all data for the current date range in one file",
        ],
      },
      {
        id: "settings",
        name: "Settings",
        url: "/admin/settings",
        role: "all",
        bullets: [
          { text: "General tab — toggle public nav pages on/off: Classes, Schedule, Merch, Blog, About, Contact", role: "super" },
          { text: "Class Types tab — create, edit, delete, or deactivate class types; set name, description, duration, price, capacity, linked certification type, and eligible add-ons", role: "super" },
          { text: "Grades tab — configure preset grade values and labels used in the Grading Tool", role: "super" },
          { text: "Zoho tab — connect or disconnect a Zoho Mail account for replying to contact form submissions", role: "super" },
          { text: "Social tab — manually trigger a sync of the Facebook social feed cache", role: "super" },
          { text: "Locations tab — create, edit, or delete training locations; set address, notes, and home-base flag", role: "manager" },
          "Enrollware tab — generate or revoke your personal Enrollware bookmarklet API key",
          { text: "Payouts tab — set the platform fee percentage, payout trigger mode, and payout schedule", role: "super" },
        ],
      },
      {
        id: "payout-settings",
        name: "Payout Settings",
        url: "/admin/profile/payment",
        role: "instructor",
        bullets: [
          "Save a PayPal payout email — the address where instructor earnings are sent when a payout batch runs",
          "Required before an instructor can create invoices — the invoice creation flow redirects here if no email is set",
          "Can be updated at any time; the next payout batch will use the current address on file",
        ],
      },
    ],
  },
];

/** Total section count across all groups — used for search result counters. */
export const TOTAL_SECTIONS = GROUPS.reduce((n, g) => n + g.sections.length, 0);
