"use client";

/**
 * OrderSummary — right-sidebar order summary displayed on booking steps 2–4.
 * Shows selected class details pulled from the booking store.
 * When a promo code is applied, shows an original price, discount line, and final total.
 * Used by: book/signin, book/details, book/create-account, book/payment
 */

import { MapPin, Clock, User, DollarSign, Tag } from "lucide-react";
import type { BookingStore, AppliedPromoCode, SelectedAddon } from "@/lib/booking-store";
import { formatClassDate, formatClassTimeRange } from "@/lib/business-time";

interface OrderSummaryProps {
  /** Session details from the booking store — null-safe (renders loading skeleton) */
  details: BookingStore["sessionDetails"];
  /** Applied promo code discount breakdown — null if no code applied */
  appliedPromoCode?: AppliedPromoCode | null;
  /** Add-ons selected at checkout — shown as extra line items above the total */
  selectedAddons?: SelectedAddon[];
}

/**
 * Renders a card summarizing the selected class session.
 * Displays class name, date, time, instructor, location, and price.
 * When appliedPromoCode is provided, shows original price, discount, and final total.
 */
export default function OrderSummary({ details, appliedPromoCode, selectedAddons = [] }: OrderSummaryProps) {
  if (!details) {
    // Skeleton while store hydrates on mount
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-2/3 mb-4" />
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 rounded w-full" />
          <div className="h-4 bg-gray-200 rounded w-4/5" />
          <div className="h-4 bg-gray-200 rounded w-3/5" />
        </div>
      </div>
    );
  }

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 });

  const displayPrice = appliedPromoCode ? appliedPromoCode.finalPrice : details.price;
  const addonsTotal = selectedAddons.reduce((sum, a) => sum + a.price, 0);
  const grandTotal = displayPrice + addonsTotal;

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 flex flex-col gap-4">
      <h2 className="text-base font-bold text-gray-900">{details.className}</h2>

      <div className="flex flex-col gap-3 text-sm text-gray-700">
        {/* Date + time */}
        <div className="flex items-start gap-2.5">
          <Clock size={15} className="text-gray-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p>{formatClassDate(details.startsAt)}</p>
            <p className="text-gray-500">{formatClassTimeRange(details.startsAt, details.endsAt)}</p>
          </div>
        </div>

        {/* Instructor */}
        <div className="flex items-center gap-2.5">
          <User size={15} className="text-gray-400 shrink-0" aria-hidden="true" />
          <p>{details.instructorName}</p>
        </div>

        {/* Location */}
        <div className="flex items-start gap-2.5">
          <MapPin size={15} className="text-gray-400 mt-0.5 shrink-0" aria-hidden="true" />
          <address className="not-italic leading-relaxed">
            <span className="font-medium text-gray-800">{details.locationName}</span>
            <br />
            {details.locationAddress}
            <br />
            {details.locationCity}, {details.locationState} {details.locationZip}
          </address>
        </div>

        {/* Price — shows discount breakdown when a promo code is applied */}
        <div className="pt-2 border-t border-gray-200 mt-1">
          {appliedPromoCode ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>Original price</span>
                <span className="line-through">{fmt(appliedPromoCode.originalPrice)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-green-700">
                <span className="flex items-center gap-1.5">
                  <Tag size={13} aria-hidden="true" />
                  {appliedPromoCode.code}
                </span>
                <span>−{fmt(appliedPromoCode.discountAmount)}</span>
              </div>
              <div className="flex items-center gap-2.5 pt-1 border-t border-gray-100">
                <DollarSign size={15} className="text-gray-400 shrink-0" aria-hidden="true" />
                <p className="text-lg font-bold text-gray-900">
                  {fmt(displayPrice)}{" "}
                  <span className="text-sm font-normal text-gray-500">per person</span>
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <DollarSign size={15} className="text-gray-400 shrink-0" aria-hidden="true" />
              <p className="text-lg font-bold text-gray-900">
                {fmt(displayPrice)}{" "}
                <span className="text-sm font-normal text-gray-500">per person</span>
              </p>
            </div>
          )}

          {/* Add-ons — only shown once at least one is selected */}
          {selectedAddons.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-gray-100">
              {selectedAddons.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm text-gray-600">
                  <span>+ {a.name}</span>
                  <span>{fmt(a.price)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                <span className="text-sm font-semibold text-gray-700">Total</span>
                <span className="text-lg font-bold text-gray-900">{fmt(grandTotal)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
