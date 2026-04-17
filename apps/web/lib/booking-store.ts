/**
 * booking-store.ts — sessionStorage-backed state for the multi-step booking wizard.
 * Persists session selection, customer details, and auth state across all 5 booking steps.
 * Used by: all pages under app/(public)/book/
 */

export interface BookingStore {
  /** UUID of the selected class_sessions record */
  sessionId: string | null;
  /** Denormalized session details — avoids re-fetching on each step */
  sessionDetails: {
    className: string;
    instructorName: string;
    startsAt: string;
    endsAt: string;
    locationName: string;
    locationAddress: string;
    locationCity: string;
    locationState: string;
    locationZip: string;
    price: number;
    spotsRemaining: number;
  } | null;
  /** Step 2b form data — persisted so back navigation pre-populates the form */
  customerDetails: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  /** true = new customer went through steps 2b/3; false = existing customer signed in via 2a */
  isNewCustomer: boolean;
  /** Supabase auth user.id — set after sign-in (step 2a) or account creation (step 3) */
  customerId: string | null;
}

const STORE_KEY = "superhero_cpr_booking";

/**
 * Reads the current booking store from sessionStorage.
 * Returns an empty store if running server-side or if no data is stored yet.
 */
export function getBookingStore(): BookingStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as BookingStore) : emptyStore();
  } catch {
    return emptyStore();
  }
}

/**
 * Merges the given partial data into the existing booking store in sessionStorage.
 * Does nothing when called server-side.
 * @param data - Partial store fields to update
 */
export function setBookingStore(data: Partial<BookingStore>): void {
  if (typeof window === "undefined") return;
  const current = getBookingStore();
  sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...current, ...data }));
}

/**
 * Removes the booking store from sessionStorage entirely.
 * Called on Step 5 (confirmation) to clean up after a completed booking.
 */
export function clearBookingStore(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORE_KEY);
}

/** Returns a blank BookingStore with all fields null/false. */
function emptyStore(): BookingStore {
  return {
    sessionId: null,
    sessionDetails: null,
    customerDetails: null,
    isNewCustomer: false,
    customerId: null,
  };
}
