# Admin Analytics Build Guide
**Route:** `/admin/analytics`
**File:** `app/(admin)/analytics/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the analytics page for **Superhero CPR**. This page gives super admins a comprehensive view of business performance across revenue, classes, students, invoices, and merch. All data is relational and cross-referenceable. A global date range filter applies to all sections simultaneously. The page is designed for exploration — the super admin should be able to ask and answer business questions here.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Recharts** — for all charts (`import { ... } from 'recharts'`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Super Admin only.

---

## Architecture

This page is a **client component** — the date range filter drives re-fetches and all charts need to be interactive. Server renders the shell and initial data for the default date range (last 90 days). Client component handles filter changes and re-fetching.

`page.tsx` — thin server wrapper, fetches initial data for default range, passes to `AnalyticsClient.tsx`
`AnalyticsClient.tsx` — client component owning filter state and all chart data

---

## Date Range Filter

**Always visible at the top of the page — sticky on scroll.**

**Preset buttons (pill style):**
- Last 30 days
- Last 90 days ← default
- This year
- Last year
- All time

**Custom range:**
- From / To date inputs
- Apply button

On filter change: re-fetch all data for the new range. Show a subtle loading state per section (skeleton or spinner) while data loads — do not blank the entire page.

---

## Export

**`"Export CSV"` button** — top right of page header.

Downloads a CSV containing the key metrics for the current date range:
- Revenue summary (online, invoice, cash/check, total)
- Class counts and capacity stats
- Student counts (new, returning)
- Invoice stats (sent, paid, cancelled)
- Merch sales summary

---

## Section 1 — Overview Strip

Four metric cards in a row at the top. Always visible, always the first thing the super admin sees.

| Metric | Source |
|---|---|
| Total Revenue | Sum of all completed payments in range |
| Online Booking Revenue | Payments where `payment_type = 'online'` |
| Invoice Revenue | Payments where `payment_type = 'invoice'` |
| Students Trained | Count of distinct customers with at least one completed booking in range |

Cards show:
- Large number — the metric value
- Label — metric name
- Trend indicator — `"▲ 12% vs previous period"` or `"▼ 3% vs previous period"` in green/red

The previous period is automatically calculated as the same length of time immediately before the selected range.

---

## Section 2 — Revenue

**Heading:** `"Revenue"`

### Revenue Over Time
Line chart — x axis: dates (grouped by week for ranges < 90 days, by month for longer ranges). y axis: revenue in dollars.

Two lines:
- Online booking revenue
- Invoice revenue

Tooltip shows both values on hover.

### Revenue by Class Type
Horizontal bar chart — one bar per class type. Length = total revenue from bookings for that class type in range. Shows dollar amount on each bar.

### Revenue by Instructor
Horizontal bar chart — one bar per instructor (by name). Length = total invoice revenue that instructor generated in range. Shows dollar amount on each bar.

---

## Section 3 — Classes

**Heading:** `"Classes"`

### Classes Per Month
Bar chart — one bar per month in range. Height = number of sessions with `status = 'completed'` that month.

### Capacity Utilization
Horizontal bar chart — one bar per class type.
- Bar length = average % of capacity filled across all sessions of that type
- e.g. `"BLS — 78% avg capacity"`
- Color: green if ≥ 80%, amber if 50–79%, red if < 50%

### Cancellation Rate
Single stat card: `"[n]% of sessions cancelled"` in the selected range.
Below: `"[n] sessions cancelled out of [total] scheduled"`

### Most Active Instructors
Simple ranked list — instructors ordered by number of completed sessions in range.
Shows: name, completed sessions count, total students trained.

---

## Section 4 — Students

**Heading:** `"Students"`

### New vs Returning
Two stat cards side by side:
- New customers — profiles created within the range who have at least one booking
- Returning customers — customers created before the range start who have a booking in range

### Certification Renewal Rate
Stat card: `"[n]% of expiring certs renewed"`
Calculation: of customers whose cert expired in range, how many booked a renewal class within 90 days of expiry.

### Top Employers
Table — pulled from `roster_records.employer` field (non-null only).
Shows: employer name, student count. Top 10 by count.

Useful for identifying corporate clients worth targeting for group invoices.

---

## Section 5 — Invoices

**Heading:** `"Invoices"`

### Invoice Conversion Rate
Two stat cards:
- Invoices sent: count of invoices created in range
- Invoices paid: count with `status = 'paid'` and `paid_at` in range
- Conversion rate: `"[n]% paid"`

### Average Time to Payment
Stat card: average days between `created_at` and `paid_at` for paid invoices in range.
e.g. `"Avg 4.2 days to payment"`

### Invoice Revenue by Instructor
Same horizontal bar chart as revenue section but focused on invoice count rather than amount.
Shows instructors ranked by number of invoices sent.

### Invoice Status Breakdown
Simple donut or pie chart:
- Sent (unpaid)
- Paid
- Cancelled

---

## Section 6 — Merch

**Heading:** `"Merch"`

### Merch Revenue Over Time
Line chart — merch order revenue by week/month in range.

### Sales by Product
Horizontal bar chart — one bar per product. Length = total units sold in range.
Shows product name and units sold.

### Revenue by Product
Same layout as sales but by revenue amount.

### Low Stock Alert (informational)
If any variants are at or below their `low_stock_threshold`, show an amber notice:
```
"[n] variants are at or below their low stock threshold."
[Go to Merch Management →]
```
This is informational only — no actions on this page.

---

## Data Fetching Strategy

All analytics data is fetched via Supabase queries. For each section, fetch the raw records and aggregate in TypeScript rather than using complex SQL — this keeps the queries readable and maintainable.

```typescript
// Example: Revenue over time
const { data: payments } = await supabase
  .from('payments')
  .select('amount, payment_type, created_at')
  .eq('status', 'completed')
  .gte('created_at', rangeStart)
  .lte('created_at', rangeEnd)

// Group by week/month in TypeScript
const grouped = groupByPeriod(payments, periodSize)
```

On filter change, re-fetch all sections in parallel:
```typescript
const [payments, sessions, bookings, invoices, orders] = await Promise.all([
  fetchPayments(range),
  fetchSessions(range),
  fetchBookings(range),
  fetchInvoices(range),
  fetchOrders(range),
])
```

---

## Chart Design Notes

All charts use **Recharts**. Keep chart styling consistent:
- Colors: use a consistent palette — primary red (`#dc2626`) for the main metric, gray (`#6b7280`) for secondary metrics, amber (`#d97706`) for warnings
- Tooltips: custom styled to match admin design system — white bg, border, clean typography
- Axes: muted gray labels, no gridlines on y axis (horizontal lines only, very subtle)
- Legends: below the chart, left-aligned
- Responsive: all charts use `<ResponsiveContainer width="100%" height={280}>`

---

## Page Layout

```
[Date Range Filter — sticky]
[Export Button]

[Overview Strip — 4 cards]

[Revenue]
  [Revenue Over Time — full width]
  [Revenue by Class Type] [Revenue by Instructor] ← 2 col on desktop

[Classes]
  [Classes Per Month — full width]
  [Capacity Utilization] [Cancellation Rate + Active Instructors] ← 2 col on desktop

[Students]
  [New vs Returning] [Cert Renewal Rate] ← 2 col on desktop
  [Top Employers — full width]

[Invoices]
  [Invoice Conversion Rate] [Avg Time to Payment] ← 2 col on desktop
  [Invoice Revenue by Instructor] [Invoice Status Breakdown] ← 2 col on desktop

[Merch]
  [Merch Revenue Over Time — full width]
  [Sales by Product] [Revenue by Product] ← 2 col on desktop
  [Low Stock Alert — if applicable]
```

---

## Responsive

- Mobile: All sections single column. Charts full width. Overview strip 2×2 grid.
- Desktop: Two column layout within sections where specified. Max width `7xl`.

---

## Empty States Per Section

If no data exists for the selected range in a section, show a subtle empty state within that section's card:
- Icon: appropriate Lucide icon
- Text: `"No data for this period."`

Do not hide entire sections — keep the structure visible so the super admin understands what the section represents.

---

## Accessibility

- All charts must have `aria-label` describing what the chart shows
- Color should not be the only indicator — use labels and tooltips
- Date range inputs must have `<label>` elements
- Trend indicators must include text direction as well as color — `"▲ up 12%"` not just green

---

## What NOT to Do

- Do not put action buttons on this page — analytics is read-only
- Do not fetch all data at once on initial load — use the default range (last 90 days)
- Do not use client-side filtering on pre-loaded data — re-fetch when range changes
- Do not use any chart library other than Recharts
- Do not blank the entire page on filter change — update sections independently
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to super admin
- [ ] Date range filter works — all presets and custom range
- [ ] All sections re-fetch independently when range changes
- [ ] Loading states shown per section during re-fetch
- [ ] Overview strip shows 4 metrics with trend indicators
- [ ] Revenue over time line chart renders correctly
- [ ] Revenue by class type bar chart renders correctly
- [ ] Revenue by instructor bar chart renders correctly
- [ ] Classes per month bar chart renders correctly
- [ ] Capacity utilization bar chart with color coding renders correctly
- [ ] Cancellation rate stat renders correctly
- [ ] Most active instructors list renders correctly
- [ ] New vs returning student stats render correctly
- [ ] Cert renewal rate stat renders correctly
- [ ] Top employers table renders correctly
- [ ] Invoice conversion rate stats render correctly
- [ ] Average time to payment stat renders correctly
- [ ] Invoice status donut chart renders correctly
- [ ] Merch revenue over time line chart renders correctly
- [ ] Sales and revenue by product bar charts render correctly
- [ ] Low stock alert shown when applicable
- [ ] Export CSV downloads correct data for current range
- [ ] Empty states shown per section when no data
- [ ] All charts are responsive via ResponsiveContainer
- [ ] Fully responsive layout
- [ ] No TypeScript errors
- [ ] No ESLint errors
