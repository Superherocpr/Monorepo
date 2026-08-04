# Admin Merch Management Build Guide
**Route:** `/admin/merch`
**File:** `app/(admin)/merch/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the merch management page for **Superhero CPR**. Super admins manage all products, variants, stock levels, and image uploads from this page. All stock adjustments are logged. Product images upload via an API route to AWS S3.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **AWS S3** — for product image storage

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Super Admin only.

---

## Schema Addition

```sql
create table stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants(id),
  adjusted_by uuid not null references profiles(id),
  previous_quantity int not null,
  new_quantity int not null,
  notes text,
  created_at timestamptz not null default now()
);
```

---

## Architecture

Hybrid — server fetches all products with variants. Client component handles all mutations via API routes.

---

## Data Fetching

```typescript
const { data: products } = await supabase
  .from('products')
  .select(`
    id, name, description, price, image_url,
    active, low_stock_threshold, created_at,
    product_variants (
      id, size, stock_quantity
    )
  `)
  .order('name')
```

Sort variants by size order: XS, S, M, L, XL, XXL, One Size (same utility as merch page).

---

## Page Header

- `<h1>`: `"Merch Management"`
- `"+ Add Product"` button — opens slide-in panel

---

## Products List

All products shown — active and inactive. No toggle to hide inactive.

**Each product card shows:**
- Product image — 80×80px thumbnail. If no image: gray placeholder square.
- Product name — bold (`<h2>`)
- Description — muted, clamped to 2 lines
- Price — formatted as currency
- Active/inactive badge — green `"Active"` or gray `"Inactive"`
- Low stock threshold — `"Alert at [n] units"`
- Variant stock grid — compact table showing size and current stock per variant:
  ```
  S: 12   M: 0   L: 5   XL: 8
  ```
  Variants at or below threshold shown in amber. Variants at 0 shown in red.
- **Actions row:**
  - `"Edit"` — opens edit slide-in panel
  - `"Activate"` / `"Deactivate"` toggle
  - `"Adjust Stock"` — opens stock adjustment panel

---

## Add / Edit Product Panel

Slide-in from the right. Same fields for add and edit (edit pre-filled).

**Fields:**
- Name (required)
- Description (optional)
- Price (required) — currency input
- Low stock threshold (required) — number input, default 5
- Active — boolean toggle, default true
- Image — file input (JPG, PNG, WEBP, max 5MB)
- Variants — list of size + initial stock quantity pairs

**Variant management inside the panel:**
- List of current variants (size + stock)
- `"+ Add Size"` button — adds a new row with size dropdown and stock input
- Remove button per variant — only shown if `stock_quantity = 0`
- Size options: XS, S, M, L, XL, XXL, One Size
- Cannot add duplicate sizes

**On submit (add):**
1. Upload image via API route if file selected
2. Insert product record
3. Insert product_variant records
4. Close panel, refresh list

**On submit (edit):**
1. Upload new image if file changed
2. Update product record
3. Handle variant changes:
   - New variants: insert
   - Removed variants (stock = 0 only): delete
   - Existing variants: stock is managed via Adjust Stock — not editable here

---

## Image Upload API Route

**File:** `app/api/merch/upload-image/route.ts`

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file') as File

  if (!file) {
    return Response.json({ success: false, error: 'No file provided' }, { status: 400 })
  }

  // Validate file type and size
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    return Response.json({ success: false, error: 'Invalid file type' }, { status: 400 })
  }
  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ success: false, error: 'File too large (max 5MB)' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const key = `merch/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`

  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: key,
    Body: buffer,
    ContentType: file.type,
  }))

  const url = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
  return Response.json({ success: true, url })
}
```

**Environment variables required:**
```
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=
```

---

## Adjust Stock Panel

Slide-in panel for a specific product.

**Shows:**
- Product name
- Each variant in a list:
  - Size label
  - Current stock quantity (read-only display)
  - New quantity input — number input, min 0
  - These are **absolute values** — set to exactly this number, not add/subtract
- Optional notes field — reason for adjustment e.g. `"Received new shipment"`
- `"Save Adjustments"` button

**On submit:**
For each variant where new quantity differs from current:
1. Update `product_variants.stock_quantity`
2. Insert record into `stock_adjustments`:
   - `variant_id`
   - `adjusted_by` = current staff user id
   - `previous_quantity` = old value
   - `new_quantity` = new value
   - `notes` = optional notes

Only variants that actually changed get logged — skip unchanged ones.

---

## Activate / Deactivate

One-click toggle — no confirmation needed.
- Sets `products.active = true/false`
- Badge updates immediately
- Deactivated products hidden from public catalog but still visible here

---

## Empty State

If no products:
- Icon: `ShoppingBag` from Lucide
- Text: `"No products yet."`
- `"Add your first product"` button

---

## Responsive

- Mobile: Single column cards
- Desktop: Two column card grid

---

## Accessibility

- Stock quantity inputs must have `aria-label="Stock quantity for [size]"`
- New quantity inputs must have `aria-label="New stock quantity for [size]"`
- Image file input must have visible label
- Variant remove buttons must have `aria-label="Remove [size] variant"`

---

## What NOT to Do

- Do not upload images directly from browser to S3 — always route through API
- Do not allow removing variants with stock > 0
- Do not make stock adjustments relative (add/subtract) — always absolute (set to)
- Do not skip logging stock adjustments — every change must be recorded
- Do not allow duplicate sizes on the same product
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to super admin
- [ ] Products list shows all products with active/inactive badge
- [ ] Variant stock shown per product with amber/red color coding
- [ ] Add product panel works — image upload, variants, all fields
- [ ] Edit product panel pre-filled, saves correctly
- [ ] Image uploads via API route to S3 — not direct browser upload
- [ ] Activate/deactivate toggle works
- [ ] Adjust stock panel shows all variants with current quantities
- [ ] Stock adjustments are absolute values
- [ ] Every stock change logged in stock_adjustments with adjusted_by
- [ ] Only changed variants are logged
- [ ] Variants with stock > 0 cannot be removed
- [ ] No duplicate sizes allowed per product
- [ ] Empty state renders correctly
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
