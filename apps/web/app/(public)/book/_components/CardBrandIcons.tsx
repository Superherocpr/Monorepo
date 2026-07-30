/**
 * CardBrandIcons — accepted-card-network badges (Visa, Mastercard, Amex, Discover)
 * shown on the credit card checkout form. Simplified inline SVG marks — not
 * pixel-exact brand assets — matching the common "we accept" badge row pattern
 * used across e-commerce checkouts. These are the four networks PayPal's
 * Advanced Credit and Debit Card processing supports.
 * Used by: book/payment (CardPaymentForm).
 */

/** Shared sizing so all four badges align in a row. */
const BADGE_CLASS = "h-6 w-9 rounded shrink-0";

function VisaIcon() {
  return (
    <svg viewBox="0 0 36 24" className={BADGE_CLASS} role="img" aria-label="Visa">
      <rect width="36" height="24" rx="3" fill="#1A1F71" />
      <text
        x="18"
        y="16.5"
        textAnchor="middle"
        fontSize="10"
        fontStyle="italic"
        fontWeight="700"
        fontFamily="Arial, sans-serif"
        fill="#ffffff"
      >
        VISA
      </text>
    </svg>
  );
}

function MastercardIcon() {
  return (
    <svg viewBox="0 0 36 24" className={BADGE_CLASS} role="img" aria-label="Mastercard">
      <rect width="36" height="24" rx="3" fill="#F5F5F5" />
      <circle cx="15" cy="12" r="7" fill="#EB001B" />
      <circle cx="21" cy="12" r="7" fill="#F79E1B" />
      <path
        d="M18 6.5a7 7 0 0 1 0 11 7 7 0 0 1 0-11Z"
        fill="#FF5F00"
      />
    </svg>
  );
}

function AmexIcon() {
  return (
    <svg viewBox="0 0 36 24" className={BADGE_CLASS} role="img" aria-label="American Express">
      <rect width="36" height="24" rx="3" fill="#006FCF" />
      <text
        x="18"
        y="16"
        textAnchor="middle"
        fontSize="8"
        fontWeight="700"
        fontFamily="Arial, sans-serif"
        fill="#ffffff"
      >
        AMEX
      </text>
    </svg>
  );
}

function DiscoverIcon() {
  return (
    <svg viewBox="0 0 36 24" className={BADGE_CLASS} role="img" aria-label="Discover">
      <rect width="36" height="24" rx="3" fill="#1B1B1B" />
      <text
        x="15"
        y="13"
        textAnchor="middle"
        fontSize="4.8"
        fontWeight="700"
        fontFamily="Arial, sans-serif"
        fill="#ffffff"
      >
        DISCOVER
      </text>
      <circle cx="31.5" cy="17.5" r="3.8" fill="#FF6000" />
    </svg>
  );
}

/** Renders the row of accepted card network badges — Visa, Mastercard, Amex, Discover. */
export default function CardBrandIcons() {
  return (
    <div className="flex items-center gap-1.5" aria-label="We accept Visa, Mastercard, American Express, and Discover">
      <VisaIcon />
      <MastercardIcon />
      <AmexIcon />
      <DiscoverIcon />
    </div>
  );
}
