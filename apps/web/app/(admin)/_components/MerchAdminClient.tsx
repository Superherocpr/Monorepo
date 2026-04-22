"use client";

/**
 * MerchAdminClient — client component for all merch admin UI.
 * Handles product listing, add/edit panels, image uploads, activate/deactivate,
 * and stock adjustment with logging.
 * Used by: app/(admin)/admin/merch/page.tsx
 */

import { useState, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import type { ProductWithVariants, ProductVariant } from "@/types/merch";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Canonical size order for variant display and dropdowns. */
const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "One Size"] as const;
type SizeOption = (typeof SIZE_ORDER)[number];

// ─── Local types ──────────────────────────────────────────────────────────────

/** A variant row in the add/edit product form. */
interface VariantFormRow {
  /** Stable client-side key — not the DB id (new rows don't have one yet). */
  key: string;
  /** The DB variant id, or null for newly-added rows. */
  id: string | null;
  size: string;
  stock_quantity: number;
}

/** Form state for add / edit product panel. */
interface ProductForm {
  name: string;
  description: string;
  price: string;
  low_stock_threshold: string;
  active: boolean;
  /** Newly-selected image File (not yet uploaded). Null = no change. */
  imageFile: File | null;
  /** Preview data URL for the selected image file. */
  imagePreview: string | null;
  /** Existing image URL on the product (if editing). */
  existingImageUrl: string | null;
  variants: VariantFormRow[];
}

/** Per-variant row in the stock adjustment panel. */
interface StockAdjustRow {
  variantId: string;
  size: string;
  currentQty: number;
  newQty: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Sorts product variants by the canonical SIZE_ORDER.
 * Sizes not in the list fall to the end alphabetically.
 * @param variants - Unsorted variants from the DB.
 * @returns Sorted variants array.
 */
function sortVariants(variants: ProductVariant[]): ProductVariant[] {
  return [...variants].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.size as SizeOption);
    const bi = SIZE_ORDER.indexOf(b.size as SizeOption);
    if (ai === -1 && bi === -1) return a.size.localeCompare(b.size);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

/**
 * Formats a numeric price as USD currency string.
 * e.g. 19.99 → "$19.99"
 * @param price - The price value.
 */
function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(price);
}

/**
 * Returns a blank ProductForm suitable for the Add panel.
 */
function blankProductForm(): ProductForm {
  return {
    name: "",
    description: "",
    price: "",
    low_stock_threshold: "5",
    active: true,
    imageFile: null,
    imagePreview: null,
    existingImageUrl: null,
    variants: [],
  };
}

/**
 * Builds a ProductForm pre-filled with an existing product's data.
 * @param product - The product to edit.
 */
function productToForm(product: ProductWithVariants): ProductForm {
  const sorted = sortVariants(product.product_variants);
  return {
    name: product.name,
    description: product.description ?? "",
    price: product.price.toString(),
    low_stock_threshold: product.low_stock_threshold.toString(),
    active: product.active,
    imageFile: null,
    imagePreview: null,
    existingImageUrl: product.image_url,
    variants: sorted.map((v) => ({
      key: v.id,
      id: v.id,
      size: v.size,
      stock_quantity: v.stock_quantity,
    })),
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * A stock pill that turns amber at-or-below threshold and red at zero.
 * @param qty - Current stock quantity.
 * @param threshold - Low stock alert threshold.
 * @param size - Size label.
 */
function StockPill({
  qty,
  threshold,
  size,
}: {
  qty: number;
  threshold: number;
  size: string;
}) {
  const color =
    qty === 0
      ? "bg-red-100 text-red-700"
      : qty <= threshold
        ? "bg-amber-100 text-amber-700"
        : "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>
      {size}: {qty}
    </span>
  );
}

/**
 * Slide-in overlay panel from the right side of the screen.
 * @param open - Whether the panel is visible.
 * @param onClose - Callback to close the panel.
 * @param title - Panel heading text.
 * @param children - Panel body content.
 */
function SlidePanel({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * Props for MerchAdminClient.
 */
interface MerchAdminClientProps {
  /** All products with variants, fetched server-side. */
  initialProducts: ProductWithVariants[];
  /** The logged-in super admin's user id — used for stock_adjustments logging. */
  actorId: string;
}

/**
 * Client component for the admin merch management page.
 * Manages product list in local state; all mutations call API routes and update state.
 * @param initialProducts - Products pre-fetched server-side.
 * @param actorId - The super admin performing actions (for audit logs).
 */
export default function MerchAdminClient({
  initialProducts,
  actorId,
}: MerchAdminClientProps) {
  // ── State ───────────────────────────────────────────────────────────────────
  const [products, setProducts] =
    useState<ProductWithVariants[]>(initialProducts);

  // Panel visibility
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<ProductWithVariants | null>(
    null
  );
  const [adjustProduct, setAdjustProduct] =
    useState<ProductWithVariants | null>(null);

  // Product form state (shared for add and edit)
  const [form, setForm] = useState<ProductForm>(blankProductForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  // Stock adjustment form state
  const [adjustRows, setAdjustRows] = useState<StockAdjustRow[]>([]);
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Derived: sizes already used in the current form ────────────────────────
  const usedSizes = useMemo(
    () => new Set(form.variants.map((v) => v.size)),
    [form.variants]
  );

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Opens the Add Product panel with a blank form.
   */
  function openAddPanel() {
    setForm(blankProductForm());
    setFormError(null);
    setAddPanelOpen(true);
  }

  /**
   * Opens the Edit Product panel pre-filled with the product's data.
   * @param product - The product to edit.
   */
  function openEditPanel(product: ProductWithVariants) {
    setForm(productToForm(product));
    setFormError(null);
    setEditProduct(product);
  }

  /**
   * Opens the stock adjustment panel for a product.
   * Initialises the adjust rows with current quantities.
   * @param product - The product whose stock to adjust.
   */
  function openAdjustPanel(product: ProductWithVariants) {
    const sorted = sortVariants(product.product_variants);
    setAdjustRows(
      sorted.map((v) => ({
        variantId: v.id,
        size: v.size,
        currentQty: v.stock_quantity,
        newQty: v.stock_quantity,
      }))
    );
    setAdjustNotes("");
    setAdjustError(null);
    setAdjustProduct(product);
  }

  /**
   * Handles image file selection — validates type/size and sets preview.
   * @param e - The file input change event.
   */
  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      setFormError("Image must be JPG, PNG, or WEBP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormError("Image must be 5MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm((prev) => ({
        ...prev,
        imageFile: file,
        imagePreview: reader.result as string,
      }));
    };
    reader.readAsDataURL(file);
    setFormError(null);
  }

  /**
   * Adds a new blank variant row to the form.
   * Picks the first unused size from SIZE_ORDER.
   */
  function addVariantRow() {
    const nextSize = SIZE_ORDER.find((s) => !usedSizes.has(s)) ?? "One Size";
    setForm((prev) => ({
      ...prev,
      variants: [
        ...prev.variants,
        {
          key: `new-${Date.now()}`,
          id: null,
          size: nextSize,
          stock_quantity: 0,
        },
      ],
    }));
  }

  /**
   * Removes a variant row from the form.
   * Only allowed if the variant has stock_quantity = 0.
   * @param key - The client-side key of the row to remove.
   */
  function removeVariantRow(key: string) {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.filter((v) => v.key !== key),
    }));
  }

  /**
   * Updates a single field on a variant row in the form.
   * @param key - The client-side key of the row.
   * @param field - The field to update.
   * @param value - The new value.
   */
  function updateVariantRow(
    key: string,
    field: keyof Pick<VariantFormRow, "size" | "stock_quantity">,
    value: string | number
  ) {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((v) =>
        v.key === key ? { ...v, [field]: value } : v
      ),
    }));
  }

  /**
   * Updates a single adjust row's new quantity.
   * @param variantId - The DB id of the variant.
   * @param newQty - The new absolute stock quantity.
   */
  function updateAdjustRow(variantId: string, newQty: number) {
    setAdjustRows((prev) =>
      prev.map((r) => (r.variantId === variantId ? { ...r, newQty } : r))
    );
  }

  // ── API calls ────────────────────────────────────────────────────────────────

  /**
   * Uploads an image file to S3 via the API route.
   * Returns the public URL of the uploaded image.
   * @param file - The image File to upload.
   * @returns The public S3 URL, or null on failure.
   */
  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/merch/upload-image", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.url ?? null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Submits the add/edit product form.
   * Handles image upload, product insert/update, and variant management.
   * @param isEdit - True when editing, false when adding.
   */
  async function handleProductSubmit(isEdit: boolean) {
    setFormError(null);

    // Validate required fields
    if (!form.name.trim()) {
      setFormError("Product name is required.");
      return;
    }
    const priceNum = parseFloat(form.price);
    if (isNaN(priceNum) || priceNum < 0) {
      setFormError("Please enter a valid price.");
      return;
    }
    const threshold = parseInt(form.low_stock_threshold, 10);
    if (isNaN(threshold) || threshold < 0) {
      setFormError("Low stock threshold must be 0 or greater.");
      return;
    }
    // Check for duplicate sizes in the form
    const sizes = form.variants.map((v) => v.size);
    if (new Set(sizes).size !== sizes.length) {
      setFormError("Each size must be unique.");
      return;
    }

    setFormSaving(true);

    try {
      // Step 1: Upload image if a new file was selected
      let imageUrl: string | null = form.existingImageUrl;
      if (form.imageFile) {
        const uploaded = await uploadImage(form.imageFile);
        if (!uploaded) {
          setFormError("Image upload failed. Please try again.");
          setFormSaving(false);
          return;
        }
        imageUrl = uploaded;
      }

      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: priceNum,
        low_stock_threshold: threshold,
        active: form.active,
        image_url: imageUrl,
        variants: form.variants.map((v) => ({
          id: v.id,
          size: v.size,
          stock_quantity: v.stock_quantity,
        })),
      };

      if (isEdit && editProduct) {
        // Edit existing product
        const res = await fetch(`/api/merch/${editProduct.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.product) {
          setFormError(data.error ?? "Failed to save product.");
          setFormSaving(false);
          return;
        }
        setProducts((prev) =>
          prev.map((p) => (p.id === editProduct.id ? data.product : p))
        );
        setEditProduct(null);
      } else {
        // Create new product
        const res = await fetch("/api/merch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.product) {
          setFormError(data.error ?? "Failed to create product.");
          setFormSaving(false);
          return;
        }
        setProducts((prev) => [...prev, data.product]);
        setAddPanelOpen(false);
      }
    } catch {
      setFormError("An unexpected error occurred.");
    } finally {
      setFormSaving(false);
    }
  }

  /**
   * Toggles a product's active status.
   * Optimistic update with server confirmation.
   * @param product - The product to toggle.
   */
  async function handleToggleActive(product: ProductWithVariants) {
    // Optimistic update
    setProducts((prev) =>
      prev.map((p) =>
        p.id === product.id ? { ...p, active: !p.active } : p
      )
    );
    try {
      const res = await fetch(`/api/merch/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !product.active }),
      });
      const data = await res.json();
      if (!res.ok || !data.product) {
        // Revert on failure
        setProducts((prev) =>
          prev.map((p) => (p.id === product.id ? product : p))
        );
      } else {
        setProducts((prev) =>
          prev.map((p) => (p.id === product.id ? data.product : p))
        );
      }
    } catch {
      // Revert on failure
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? product : p))
      );
    }
  }

  /**
   * Submits stock adjustments for the current adjust product.
   * Only changed variants are sent to the server.
   */
  async function handleAdjustSubmit() {
    if (!adjustProduct) return;
    setAdjustError(null);

    // Only send rows where quantity changed
    const changed = adjustRows.filter((r) => r.newQty !== r.currentQty);
    if (changed.length === 0) {
      setAdjustProduct(null);
      return;
    }

    setAdjustSaving(true);
    try {
      const res = await fetch(`/api/merch/${adjustProduct.id}/adjust-stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustments: changed.map((r) => ({
            variantId: r.variantId,
            newQuantity: r.newQty,
          })),
          notes: adjustNotes.trim() || null,
          actorId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdjustError(data.error ?? "Failed to save stock adjustments.");
        setAdjustSaving(false);
        return;
      }
      // Update local state for the adjusted variants
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== adjustProduct.id) return p;
          return {
            ...p,
            product_variants: p.product_variants.map((v) => {
              const row = changed.find((r) => r.variantId === v.id);
              return row ? { ...v, stock_quantity: row.newQty } : v;
            }),
          };
        })
      );
      setAdjustProduct(null);
    } catch {
      setAdjustError("An unexpected error occurred.");
    } finally {
      setAdjustSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Page header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Merch Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage products, variants, and stock levels.
          </p>
        </div>
        <button
          onClick={openAddPanel}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >
          + Add Product
        </button>
      </div>

      {/* Empty state */}
      {products.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 py-20 text-center">
          <p className="text-3xl" aria-hidden="true">🛍️</p>
          <p className="mt-4 font-medium text-gray-700">No products yet.</p>
          <button
            onClick={openAddPanel}
            className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Add your first product
          </button>
        </div>
      )}

      {/* Products grid */}
      {products.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2">
          {products.map((product) => {
            const sorted = sortVariants(product.product_variants);
            return (
              <div
                key={product.id}
                className="rounded-xl border border-gray-200 bg-white shadow-sm"
              >
                {/* Product card header */}
                <div className="flex items-start gap-4 p-5">
                  {/* Thumbnail */}
                  <div className="flex-shrink-0">
                    {product.image_url ? (
                      <div className="relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200">
                        <Image
                          src={product.image_url}
                          alt={product.name}
                          fill
                          className="object-cover"
                          sizes="80px"
                        />
                      </div>
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50">
                        <span className="text-xs text-gray-400">No image</span>
                      </div>
                    )}
                  </div>

                  {/* Product details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="truncate font-semibold text-gray-900">
                        {product.name}
                      </h2>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          product.active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {product.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    {product.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                        {product.description}
                      </p>
                    )}
                    <div className="mt-1 flex items-center gap-3">
                      <span className="text-sm font-medium text-gray-800">
                        {formatPrice(product.price)}
                      </span>
                      <span className="text-xs text-gray-400">
                        Alert at {product.low_stock_threshold} units
                      </span>
                    </div>
                  </div>
                </div>

                {/* Variant stock grid */}
                {sorted.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t border-gray-100 px-5 py-3">
                    {sorted.map((v) => (
                      <StockPill
                        key={v.id}
                        size={v.size}
                        qty={v.stock_quantity}
                        threshold={product.low_stock_threshold}
                      />
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-3">
                  <button
                    onClick={() => openEditPanel(product)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggleActive(product)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {product.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    onClick={() => openAdjustPanel(product)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Adjust Stock
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add / Edit Product Panel ─────────────────────────────────────────── */}
      <SlidePanel
        open={addPanelOpen || editProduct !== null}
        onClose={() => {
          setAddPanelOpen(false);
          setEditProduct(null);
        }}
        title={editProduct ? "Edit Product" : "Add Product"}
      >
        <ProductFormBody
          form={form}
          setForm={setForm}
          isEdit={editProduct !== null}
          formError={formError}
          formSaving={formSaving}
          usedSizes={usedSizes}
          fileInputRef={fileInputRef}
          onImageChange={handleImageChange}
          onAddVariant={addVariantRow}
          onRemoveVariant={removeVariantRow}
          onUpdateVariant={updateVariantRow}
          onSubmit={() => handleProductSubmit(editProduct !== null)}
          onCancel={() => {
            setAddPanelOpen(false);
            setEditProduct(null);
          }}
        />
      </SlidePanel>

      {/* ── Adjust Stock Panel ───────────────────────────────────────────────── */}
      <SlidePanel
        open={adjustProduct !== null}
        onClose={() => setAdjustProduct(null)}
        title={`Adjust Stock — ${adjustProduct?.name ?? ""}`}
      >
        {adjustProduct && (
          <div className="space-y-6">
            {adjustRows.length === 0 && (
              <p className="text-sm text-gray-500">
                This product has no variants to adjust.
              </p>
            )}
            {adjustRows.map((row) => (
              <div key={row.variantId} className="flex items-center gap-4">
                <span className="w-16 text-sm font-medium text-gray-700">
                  {row.size}
                </span>
                <span className="w-20 text-sm text-gray-500">
                  Now: <strong>{row.currentQty}</strong>
                </span>
                <div className="flex-1">
                  <label
                    className="sr-only"
                    htmlFor={`adj-${row.variantId}`}
                  >
                    New stock quantity for {row.size}
                  </label>
                  <input
                    id={`adj-${row.variantId}`}
                    aria-label={`New stock quantity for ${row.size}`}
                    type="number"
                    min={0}
                    value={row.newQty}
                    onChange={(e) =>
                      updateAdjustRow(
                        row.variantId,
                        Math.max(0, parseInt(e.target.value, 10) || 0)
                      )
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>
            ))}

            {/* Notes */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Notes (optional)
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Received new shipment"
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>

            {adjustError && (
              <p className="text-sm text-red-600">{adjustError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setAdjustProduct(null)}
                className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAdjustSubmit}
                disabled={adjustSaving}
                className="flex-1 rounded-md bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {adjustSaving ? "Saving…" : "Save Adjustments"}
              </button>
            </div>
          </div>
        )}
      </SlidePanel>
    </div>
  );
}

// ─── Product Form Body ─────────────────────────────────────────────────────────

/**
 * Props for the ProductFormBody sub-component.
 */
interface ProductFormBodyProps {
  form: ProductForm;
  setForm: React.Dispatch<React.SetStateAction<ProductForm>>;
  isEdit: boolean;
  formError: string | null;
  formSaving: boolean;
  usedSizes: Set<string>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAddVariant: () => void;
  onRemoveVariant: (key: string) => void;
  onUpdateVariant: (
    key: string,
    field: "size" | "stock_quantity",
    value: string | number
  ) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * The inner form body for Add/Edit product panel.
 * Extracted to keep MerchAdminClient readable.
 */
function ProductFormBody({
  form,
  setForm,
  isEdit,
  formError,
  formSaving,
  usedSizes,
  fileInputRef,
  onImageChange,
  onAddVariant,
  onRemoveVariant,
  onUpdateVariant,
  onSubmit,
  onCancel,
}: ProductFormBodyProps) {
  return (
    <div className="space-y-5">
      {/* Name */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, name: e.target.value }))
          }
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          placeholder="Product name"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, description: e.target.value }))
          }
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          placeholder="Optional product description"
        />
      </div>

      {/* Price + threshold row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Price ($) <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={form.price}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, price: e.target.value }))
            }
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            placeholder="0.00"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Low stock alert <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min={0}
            value={form.low_stock_threshold}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                low_stock_threshold: e.target.value,
              }))
            }
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
        </div>
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={form.active}
          onClick={() =>
            setForm((prev) => ({ ...prev, active: !prev.active }))
          }
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
            form.active ? "bg-green-500" : "bg-gray-300"
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
              form.active ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
        <span className="text-sm text-gray-700">
          {form.active ? "Active" : "Inactive"}
        </span>
      </div>

      {/* Image */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Product Image (JPG, PNG, WEBP — max 5MB)
        </label>
        {/* Preview existing or newly selected image */}
        {(form.imagePreview ?? form.existingImageUrl) && (
          <div className="relative mb-2 h-32 w-32 overflow-hidden rounded-lg border border-gray-200">
            <Image
              src={(form.imagePreview ?? form.existingImageUrl) as string}
              alt="Product image preview"
              fill
              className="object-cover"
              sizes="128px"
            />
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onImageChange}
          className="block w-full text-sm text-gray-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-red-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-red-700 hover:file:bg-red-100"
        />
      </div>

      {/* Variants */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">
            Variants
          </label>
          <button
            type="button"
            onClick={onAddVariant}
            disabled={usedSizes.size >= SIZE_ORDER.length}
            className="text-xs font-medium text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Add Size
          </button>
        </div>
        {form.variants.length === 0 && (
          <p className="text-xs text-gray-400">No variants added yet.</p>
        )}
        <div className="space-y-2">
          {form.variants.map((v) => {
            const canRemove = v.id === null || v.stock_quantity === 0;
            return (
              <div key={v.key} className="flex items-center gap-2">
                <select
                  value={v.size}
                  onChange={(e) => onUpdateVariant(v.key, "size", e.target.value)}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none"
                >
                  {SIZE_ORDER.map((s) => (
                    <option key={s} value={s} disabled={s !== v.size && usedSizes.has(s)}>
                      {s}
                    </option>
                  ))}
                </select>
                {/* Stock input only shown for new variants — existing stock managed via Adjust Stock */}
                {v.id === null ? (
                  <div className="flex-1">
                    <label className="sr-only" htmlFor={`stock-${v.key}`}>
                      Stock quantity for {v.size}
                    </label>
                    <input
                      id={`stock-${v.key}`}
                      aria-label={`Stock quantity for ${v.size}`}
                      type="number"
                      min={0}
                      value={v.stock_quantity}
                      onChange={(e) =>
                        onUpdateVariant(
                          v.key,
                          "stock_quantity",
                          Math.max(0, parseInt(e.target.value, 10) || 0)
                        )
                      }
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none"
                      placeholder="Qty"
                    />
                  </div>
                ) : (
                  <span className="flex-1 text-xs text-gray-400">
                    Stock managed via Adjust Stock
                  </span>
                )}
                {canRemove ? (
                  <button
                    type="button"
                    aria-label={`Remove ${v.size} variant`}
                    onClick={() => onRemoveVariant(v.key)}
                    className="text-gray-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                ) : (
                  <span
                    className="cursor-not-allowed text-gray-200"
                    title="Cannot remove variant with stock > 0"
                    aria-label={`Cannot remove ${v.size} variant — stock > 0`}
                  >
                    ✕
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {formError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {formError}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={formSaving}
          className="flex-1 rounded-md bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {formSaving
            ? "Saving…"
            : isEdit
              ? "Save Changes"
              : "Create Product"}
        </button>
      </div>
    </div>
  );
}
