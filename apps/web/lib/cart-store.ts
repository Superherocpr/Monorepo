/**
 * Cart store — read/write helpers for persisting cart state in localStorage.
 * Guards are in place for SSR safety (window check).
 * Used by: app/(public)/merch/_components/MerchClient.tsx
 */

export interface CartItem {
  variantId: string;
  productId: string;
  productName: string;
  productImage: string | null;
  size: string;
  price: number;
  quantity: number;
}

const CART_KEY = "superhero_cpr_cart";

/**
 * Reads the cart from localStorage.
 * Returns an empty array on SSR or if parsing fails.
 */
export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

/**
 * Writes the full cart array to localStorage.
 * No-op on SSR.
 * @param items - The complete cart state to persist.
 */
export function setCart(items: CartItem[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}

/**
 * Removes the cart key from localStorage.
 * Called after a successful checkout to clean up state.
 */
export function clearCart(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CART_KEY);
}
