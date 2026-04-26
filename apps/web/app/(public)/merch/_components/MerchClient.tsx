"use client";

/**
 * MerchClient — product catalog, cart drawer, and PayPal checkout for /merch.
 * Client component — owns cart state (synced with localStorage), product display,
 * size/quantity selection, cart drawer, and the full checkout flow.
 * DB writes and email sends happen server-side in app/api/orders/confirm/route.ts.
 * Used by: app/(public)/merch/page.tsx
 */

import { useState, useEffect } from "react";
import Image from "next/image";
import { ShoppingCart, X, Plus, Minus } from "lucide-react";
import {
  PayPalProvider,
  PayPalOneTimePaymentButton,
} from "@paypal/react-paypal-js/sdk-v6";
import type { OnApproveDataOneTimePayments } from "@paypal/react-paypal-js/sdk-v6";
import { getCart, setCart, clearCart, type CartItem } from "@/lib/cart-store";
import type { ProductWithVariants, ProductVariant } from "@/types/merch";

// TODO: set NEXT_PUBLIC_SHIPPING_RATE in environment variables
const SHIPPING_RATE = parseFloat(process.env.NEXT_PUBLIC_SHIPPING_RATE ?? "0");

// Logical size sort order — unknown sizes fall back to alphabetical
const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "One Size"] as const;

/** Sorts product variants in logical size order. */
function sortSizes(variants: ProductVariant[]): ProductVariant[] {
  return [...variants].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.size as (typeof SIZE_ORDER)[number]);
    const bi = SIZE_ORDER.indexOf(b.size as (typeof SIZE_ORDER)[number]);
    if (ai === -1 && bi === -1) return a.size.localeCompare(b.size);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
] as const;

type CheckoutState = "cart" | "shipping" | "success" | "error";

interface ShippingForm {
  name: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

const EMPTY_SHIPPING: ShippingForm = {
  name: "",
  email: "",
  address: "",
  city: "",
  state: "",
  zip: "",
};

interface MerchClientProps {
  products: ProductWithVariants[];
}

/**
 * Top-level client component rendering the product grid, floating cart button,
 * cart drawer, shipping form, and PayPal checkout.
 */
export default function MerchClient({ products }: MerchClientProps) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("cart");
  const [shippingForm, setShippingForm] = useState<ShippingForm>(EMPTY_SHIPPING);

  // Load cart from localStorage on mount
  useEffect(() => {
    setCartItems(getCart());
  }, []);

  // Persist cart to localStorage whenever it changes
  useEffect(() => {
    setCart(cartItems);
  }, [cartItems]);

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const shipping = cartItems.length > 0 ? SHIPPING_RATE : 0;
  const total = subtotal + shipping;

  /** Adds a variant to the cart, incrementing quantity if already present. */
  function addToCart(
    product: ProductWithVariants,
    variant: ProductVariant,
    quantity: number
  ) {
    setCartItems((prev) => {
      const existing = prev.find((item) => item.variantId === variant.id);
      if (existing) {
        return prev.map((item) =>
          item.variantId === variant.id
            ? {
                ...item,
                quantity: Math.min(
                  item.quantity + quantity,
                  variant.stock_quantity
                ),
              }
            : item
        );
      }
      return [
        ...prev,
        {
          variantId: variant.id,
          productId: product.id,
          productName: product.name,
          productImage: product.image_url,
          size: variant.size,
          price: product.price,
          quantity,
        },
      ];
    });
  }

  function updateItemQuantity(variantId: string, delta: number, max: number) {
    setCartItems((prev) =>
      prev
        .map((item) =>
          item.variantId === variantId
            ? { ...item, quantity: Math.min(Math.max(item.quantity + delta, 1), max) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  function removeItem(variantId: string) {
    setCartItems((prev) => prev.filter((item) => item.variantId !== variantId));
  }

  function handleShippingChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setShippingForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const isShippingValid =
    shippingForm.name.trim() !== "" &&
    shippingForm.email.trim() !== "" &&
    shippingForm.address.trim() !== "" &&
    shippingForm.city.trim() !== "" &&
    shippingForm.state !== "" &&
    shippingForm.zip.trim() !== "";

  // v9 API: createOrder calls our server to create the PayPal order, returns { orderId }
  async function handlePayPalCreate() {
    const response = await fetch("/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cartItems,
        subtotal,
        shippingCost: shipping,
        total,
      }),
    });
    const data = await response.json().catch(() => ({ orderId: null }));
    if (!data.orderId) throw new Error("Failed to create PayPal order");
    return { orderId: data.orderId as string };
  }

  // v9 API: onApprove receives { orderId } — capture happens server-side in /api/orders/confirm
  async function handlePayPalApprove({ orderId }: OnApproveDataOneTimePayments) {
    const response = await fetch("/api/orders/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId: orderId,
        cartItems,
        shipping: shippingForm,
        subtotal,
        shippingCost: shipping,
        total,
      }),
    });

    const result = await response.json().catch(() => ({ success: false }));
    if (result.success) {
      clearCart();
      setCartItems([]);
      setCheckoutState("success");
    } else {
      setCheckoutState("error");
    }
  }

  return (
    // PayPalProvider must wrap the entire tree — mounting it inside a conditional
    // causes React 19 to block the injected <script> tag on each re-mount
    <PayPalProvider
      clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ""}
      components={["paypal-payments"]}
      pageType="checkout"
    >
    <div className="relative">
      {/* ── Product grid ── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          {products.length === 0 ? (
            <p className="text-center text-gray-500 py-20">
              No products available yet. Check back soon!
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAddToCart={addToCart}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Floating cart button — hidden when cart is empty ── */}
      {cartCount > 0 && (
        <button
          onClick={() => {
            setDrawerOpen(true);
            setCheckoutState("cart");
          }}
          aria-label={`Open cart — ${cartCount} item${cartCount !== 1 ? "s" : ""}`}
          className="fixed bottom-6 right-6 z-40 bg-red-600 hover:bg-red-700 text-white rounded-full p-4 shadow-lg transition-colors duration-150 flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 md:top-20 md:bottom-auto"
        >
          <ShoppingCart size={22} aria-hidden="true" />
          <span className="font-semibold text-sm">{cartCount}</span>
        </button>
      )}

      {/* ── Cart drawer overlay ── */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Shopping cart"
            className="fixed inset-y-0 right-0 z-50 w-full md:w-[420px] bg-white shadow-xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Your Cart</h2>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close cart"
                className="text-gray-400 hover:text-gray-600 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-sm"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {checkoutState === "success" && (
                <SuccessState
                  email={shippingForm.email}
                  onClose={() => setDrawerOpen(false)}
                />
              )}

              {checkoutState === "error" && (
                <ErrorState onRetry={() => setCheckoutState("shipping")} />
              )}

              {(checkoutState === "cart" || checkoutState === "shipping") && (
                <div className="flex flex-col">
                  {/* Item list */}
                  <div className="flex flex-col divide-y divide-gray-100">
                    {cartItems.map((item) => (
                      <CartItemRow
                        key={item.variantId}
                        item={item}
                        onUpdateQuantity={updateItemQuantity}
                        onRemove={removeItem}
                      />
                    ))}
                  </div>

                  {/* Totals */}
                  <div className="px-6 py-4 border-t border-gray-200 flex flex-col gap-2">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Subtotal</span>
                      <span>
                        {subtotal.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Shipping</span>
                      <span>
                        {shipping > 0
                          ? shipping.toLocaleString("en-US", {
                              style: "currency",
                              currency: "USD",
                            })
                          : "Free"}
                      </span>
                    </div>
                    <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-100">
                      <span>Total</span>
                      <span>
                        {total.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Shipping form — shown when proceeding to checkout */}
                  {checkoutState === "shipping" && (
                    <div className="px-6 pb-4 flex flex-col gap-3">
                      <h3 className="font-semibold text-gray-900 text-sm">
                        Shipping Information
                      </h3>
                      <ShippingFormFields
                        form={shippingForm}
                        onChange={handleShippingChange}
                      />

                      {/* PayPal button — only visible when form is complete */}
                      {isShippingValid && (
                        <div className="mt-2">
                          <PayPalOneTimePaymentButton
                            createOrder={handlePayPalCreate}
                            onApprove={handlePayPalApprove}
                            onError={() => setCheckoutState("error")}
                            presentationMode="auto"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Proceed to checkout button — shown in cart state */}
                  {checkoutState === "cart" && (
                    <div className="px-6 pb-6 flex flex-col gap-3">
                      <button
                        onClick={() => setCheckoutState("shipping")}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                      >
                        Proceed to Checkout
                      </button>
                      <button
                        onClick={() => setDrawerOpen(false)}
                        className="w-full text-sm text-gray-500 hover:text-gray-700 transition-colors duration-150"
                      >
                        Continue Shopping
                      </button>
                    </div>
                  )}

                  {/* Back link in shipping state */}
                  {checkoutState === "shipping" && (
                    <div className="px-6 pb-6">
                      <button
                        onClick={() => setCheckoutState("cart")}
                        className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-150"
                      >
                        ← Back to cart
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
    </PayPalProvider>
  );
}

// ── Product Card ──────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: ProductWithVariants;
  onAddToCart: (
    product: ProductWithVariants,
    variant: ProductVariant,
    quantity: number
  ) => void;
}

/** Renders a single product card with size/quantity selector and Add to Cart. */
function ProductCard({ product, onAddToCart }: ProductCardProps) {
  const sortedVariants = sortSizes(product.product_variants);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null
  );
  const [quantity, setQuantity] = useState(1);
  const [addedFeedback, setAddedFeedback] = useState(false);

  const selectedVariant = sortedVariants.find(
    (v) => v.id === selectedVariantId
  );

  function handleAddToCart() {
    if (!selectedVariant) return;
    onAddToCart(product, selectedVariant, quantity);

    // Show "Added!" feedback for 1.5 seconds then revert
    setAddedFeedback(true);
    setTimeout(() => setAddedFeedback(false), 1500);
  }

  return (
    <article className="border border-gray-200 rounded-xl overflow-hidden flex flex-col">
      {/* Product image */}
      <div className="relative aspect-square bg-gray-100">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm font-medium px-4 text-center">
            {product.name}
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="flex flex-col gap-3 p-5 flex-1">
        <h3 className="font-bold text-gray-900">{product.name}</h3>

        {product.description && (
          <p className="text-sm text-gray-600 line-clamp-2 leading-relaxed">
            {product.description}
          </p>
        )}

        <span className="font-semibold text-gray-900">
          {product.price.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
          })}
        </span>

        {/* Size pills */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Select size">
          {sortedVariants.map((variant) => {
            const isSelected = selectedVariantId === variant.id;
            const isOOS = variant.stock_quantity === 0;
            return (
              <button
                key={variant.id}
                onClick={() => {
                  if (!isOOS) {
                    setSelectedVariantId(isSelected ? null : variant.id);
                    setQuantity(1);
                  }
                }}
                disabled={isOOS}
                aria-pressed={isSelected}
                aria-label={`Size ${variant.size}${isOOS ? " — out of stock" : ""}`}
                className={[
                  "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                  isOOS
                    ? "bg-gray-100 text-gray-400 line-through cursor-not-allowed border-gray-200"
                    : isSelected
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-white text-gray-700 border-gray-200 hover:border-red-300",
                ].join(" ")}
              >
                {variant.size}
              </button>
            );
          })}
        </div>

        {/* Quantity selector */}
        {selectedVariant && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQuantity((q) => Math.max(q - 1, 1))}
              aria-label="Decrease quantity"
              className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:border-red-400 transition-colors duration-150"
            >
              <Minus size={14} aria-hidden="true" />
            </button>
            <span className="w-6 text-center font-medium text-gray-900 text-sm">
              {quantity}
            </span>
            <button
              onClick={() =>
                setQuantity((q) =>
                  Math.min(q + 1, selectedVariant.stock_quantity)
                )
              }
              disabled={quantity >= selectedVariant.stock_quantity}
              aria-label="Increase quantity"
              className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:border-red-400 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Add to cart */}
        <button
          onClick={handleAddToCart}
          disabled={!selectedVariant}
          className={[
            "mt-auto w-full font-semibold py-2.5 rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
            addedFeedback
              ? "bg-green-600 text-white"
              : selectedVariant
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-gray-100 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          {addedFeedback ? "Added!" : "Add to Cart"}
        </button>
      </div>
    </article>
  );
}

// ── Cart Item Row ─────────────────────────────────────────────────────────────

interface CartItemRowProps {
  item: CartItem;
  onUpdateQuantity: (variantId: string, delta: number, max: number) => void;
  onRemove: (variantId: string) => void;
}

/** Renders one line item inside the cart drawer. */
function CartItemRow({ item, onUpdateQuantity, onRemove }: CartItemRowProps) {
  // Max is stored from the original stock — in the cart we allow up to the original qty
  // The API route re-validates stock on submit
  const MAX_QTY = 99;

  return (
    <div className="flex items-start gap-4 px-6 py-4">
      {/* Thumbnail */}
      <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-gray-100 shrink-0">
        {item.productImage ? (
          <Image
            src={item.productImage}
            alt={item.productName}
            fill
            className="object-cover"
            sizes="64px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs text-center px-1">
            {item.productName}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm truncate">
          {item.productName}
        </p>
        <p className="text-xs text-gray-500">Size: {item.size}</p>

        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={() => onUpdateQuantity(item.variantId, -1, MAX_QTY)}
            aria-label="Decrease quantity"
            className="w-6 h-6 rounded border border-gray-300 flex items-center justify-center hover:border-red-400 transition-colors"
          >
            <Minus size={10} aria-hidden="true" />
          </button>
          <span className="text-sm font-medium text-gray-900 w-4 text-center">
            {item.quantity}
          </span>
          <button
            onClick={() => onUpdateQuantity(item.variantId, 1, MAX_QTY)}
            aria-label="Increase quantity"
            className="w-6 h-6 rounded border border-gray-300 flex items-center justify-center hover:border-red-400 transition-colors"
          >
            <Plus size={10} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Price + remove */}
      <div className="flex flex-col items-end gap-2 shrink-0">
        <span className="text-sm font-semibold text-gray-900">
          {(item.price * item.quantity).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
          })}
        </span>
        <button
          onClick={() => onRemove(item.variantId)}
          aria-label={`Remove ${item.productName} from cart`}
          className="text-gray-400 hover:text-red-600 transition-colors duration-150"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ── Shipping Form ─────────────────────────────────────────────────────────────

interface ShippingFormFieldsProps {
  form: ShippingForm;
  onChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => void;
}

/** Renders the shipping address fields inside the cart drawer. */
function ShippingFormFields({ form, onChange }: ShippingFormFieldsProps) {
  const inputClass =
    "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent";
  const labelClass = "text-xs font-medium text-gray-700";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor="ship-name" className={labelClass}>
          Full Name <span className="text-red-600" aria-hidden="true">*</span>
        </label>
        <input
          id="ship-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          value={form.name}
          onChange={onChange}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="ship-email" className={labelClass}>
          Email <span className="text-red-600" aria-hidden="true">*</span>
        </label>
        <input
          id="ship-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={onChange}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="ship-address" className={labelClass}>
          Address <span className="text-red-600" aria-hidden="true">*</span>
        </label>
        <input
          id="ship-address"
          name="address"
          type="text"
          autoComplete="street-address"
          required
          value={form.address}
          onChange={onChange}
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="ship-city" className={labelClass}>
            City <span className="text-red-600" aria-hidden="true">*</span>
          </label>
          <input
            id="ship-city"
            name="city"
            type="text"
            autoComplete="address-level2"
            required
            value={form.city}
            onChange={onChange}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ship-zip" className={labelClass}>
            Zip <span className="text-red-600" aria-hidden="true">*</span>
          </label>
          <input
            id="ship-zip"
            name="zip"
            type="text"
            autoComplete="postal-code"
            required
            value={form.zip}
            onChange={onChange}
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label htmlFor="ship-state" className={labelClass}>
          State <span className="text-red-600" aria-hidden="true">*</span>
        </label>
        <select
          id="ship-state"
          name="state"
          required
          value={form.state}
          onChange={onChange}
          className={inputClass + " bg-white"}
        >
          <option value="" disabled>
            Select…
          </option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Checkout Outcome States ───────────────────────────────────────────────────

interface SuccessStateProps {
  email: string;
  onClose: () => void;
}

/** Rendered in the cart drawer after a successful PayPal order. */
function SuccessState({ email, onClose }: SuccessStateProps) {
  return (
    <div className="flex flex-col items-center text-center gap-4 p-8">
      <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-green-600"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h3 className="text-xl font-bold text-gray-900">Order confirmed!</h3>
      <p className="text-gray-600 text-sm leading-relaxed">
        A confirmation email has been sent to{" "}
        <span className="font-medium">{email}</span>.
      </p>
      <button
        onClick={onClose}
        className="mt-2 bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors duration-150"
      >
        Continue Shopping
      </button>
    </div>
  );
}

interface ErrorStateProps {
  onRetry: () => void;
}

/** Rendered in the cart drawer when the order confirm API call fails. */
function ErrorState({ onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center text-center gap-4 p-8">
      <p className="text-gray-700 text-sm leading-relaxed">
        Something went wrong. Please try again or contact us at{" "}
        <a
          href="mailto:contact@superherocpr.com"
          className="text-red-600 hover:underline"
        >
          contact@superherocpr.com
        </a>
      </p>
      <button
        onClick={onRetry}
        className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors duration-150"
      >
        Try Again
      </button>
    </div>
  );
}
