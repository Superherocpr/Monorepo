"use client";

/**
 * RequestClassForm — form for customers to request a class at their location.
 * Handles all validation, submission, and success/error states.
 * Used by: /dashboard/request-class
 */

import { useState } from "react";
import type { PreferredTimeOfDay } from "@/types/class-requests";
import { PREFERRED_TIME_LABELS } from "@/types/class-requests";

/** A class type option as loaded by the server component. */
export interface ClassTypeOption {
  id: string;
  name: string;
  duration_minutes: number;
}

interface Props {
  classTypes: ClassTypeOption[];
}

/** US state abbreviations for the state dropdown. */
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

/** Returns the ISO date string (YYYY-MM-DD) for 7 days from now. */
function getMinDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split("T")[0];
}

interface FormState {
  class_type_id: string;
  preferred_date: string;
  preferred_time_of_day: PreferredTimeOfDay | "";
  group_size: string;
  venue_name: string;
  venue_address: string;
  venue_city: string;
  venue_state: string;
  venue_zip: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  class_type_id: "",
  preferred_date: "",
  preferred_time_of_day: "",
  group_size: "",
  venue_name: "",
  venue_address: "",
  venue_city: "",
  venue_state: "",
  venue_zip: "",
  notes: "",
};

/** Interactive form for submitting a customer class request. */
export default function RequestClassForm({ classTypes }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  /** Updates a single form field and clears its error. */
  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  /** Validates all fields and returns true if the form is ready to submit. */
  function validate(): boolean {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!form.class_type_id) errors.class_type_id = "Please select a class type.";
    if (!form.preferred_date) {
      errors.preferred_date = "Please select a preferred date.";
    } else if (form.preferred_date < getMinDate()) {
      errors.preferred_date = "Date must be at least 7 days from today.";
    }
    if (!form.preferred_time_of_day) errors.preferred_time_of_day = "Please select a time preference.";
    const size = parseInt(form.group_size, 10);
    if (!form.group_size || isNaN(size) || size < 1) {
      errors.group_size = "Please enter an estimated group size of at least 1.";
    }
    if (!form.venue_name.trim()) errors.venue_name = "Venue name is required.";
    if (!form.venue_address.trim()) errors.venue_address = "Street address is required.";
    if (!form.venue_city.trim()) errors.venue_city = "City is required.";
    if (!form.venue_state) errors.venue_state = "State is required.";
    if (!form.venue_zip.trim()) errors.venue_zip = "ZIP code is required.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/class-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_type_id: form.class_type_id,
          preferred_date: form.preferred_date,
          preferred_time_of_day: form.preferred_time_of_day,
          group_size: parseInt(form.group_size, 10),
          venue_name: form.venue_name.trim(),
          venue_address: form.venue_address.trim(),
          venue_city: form.venue_city.trim(),
          venue_state: form.venue_state,
          venue_zip: form.venue_zip.trim(),
          notes: form.notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setSubmitError("Unable to submit your request. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="max-w-xl mx-auto text-center py-16 px-6">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Request Submitted!</h2>
        <p className="text-gray-600 mb-2">
          We received your class request and will follow up within <strong>1–2 business days</strong>.
        </p>
        <p className="text-gray-600 mb-6">
          Check your email for a confirmation. You can track this request under{" "}
          <strong>My Class Requests</strong> in your dashboard.
        </p>
        <a
          href="/dashboard/class-requests"
          className="inline-block bg-red-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-red-700 transition-colors"
        >
          View My Requests
        </a>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-8">
      {/* Class details */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Class Details</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="class_type_id" className="block text-sm font-medium text-gray-700 mb-1">
              Class Type <span className="text-red-500">*</span>
            </label>
            <select
              id="class_type_id"
              name="class_type_id"
              value={form.class_type_id}
              onChange={handleChange}
              className={[
                "block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500",
                fieldErrors.class_type_id ? "border-red-400" : "border-gray-300",
              ].join(" ")}
            >
              <option value="">Select a class type…</option>
              {classTypes.map((ct) => (
                <option key={ct.id} value={ct.id}>
                  {ct.name} ({ct.duration_minutes} min)
                </option>
              ))}
            </select>
            {fieldErrors.class_type_id && (
              <p className="text-red-500 text-xs mt-1">{fieldErrors.class_type_id}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="preferred_date" className="block text-sm font-medium text-gray-700 mb-1">
                Preferred Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="preferred_date"
                name="preferred_date"
                value={form.preferred_date}
                min={getMinDate()}
                onChange={handleChange}
                className={[
                  "block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500",
                  fieldErrors.preferred_date ? "border-red-400" : "border-gray-300",
                ].join(" ")}
              />
              {fieldErrors.preferred_date && (
                <p className="text-red-500 text-xs mt-1">{fieldErrors.preferred_date}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Preferred Time <span className="text-red-500">*</span>
              </label>
              <select
                id="preferred_time_of_day"
                name="preferred_time_of_day"
                value={form.preferred_time_of_day}
                onChange={handleChange}
                className={[
                  "block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500",
                  fieldErrors.preferred_time_of_day ? "border-red-400" : "border-gray-300",
                ].join(" ")}
              >
                <option value="">Select a time…</option>
                {(Object.entries(PREFERRED_TIME_LABELS) as [PreferredTimeOfDay, string][]).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
              {fieldErrors.preferred_time_of_day && (
                <p className="text-red-500 text-xs mt-1">{fieldErrors.preferred_time_of_day}</p>
              )}
            </div>
          </div>

          <div className="max-w-xs">
            <label htmlFor="group_size" className="block text-sm font-medium text-gray-700 mb-1">
              Estimated Group Size <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              id="group_size"
              name="group_size"
              min={1}
              value={form.group_size}
              onChange={handleChange}
              placeholder="e.g. 12"
              className={[
                "block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500",
                fieldErrors.group_size ? "border-red-400" : "border-gray-300",
              ].join(" ")}
            />
            {fieldErrors.group_size && (
              <p className="text-red-500 text-xs mt-1">{fieldErrors.group_size}</p>
            )}
          </div>
        </div>
      </section>

      {/* Venue / Location */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Venue / Location</h2>
        <p className="text-sm text-gray-500 mb-4">
          Where would you like the class held? A <strong>$65 travel &amp; setup fee</strong> applies
          to all customer-requested classes.
        </p>
        <div className="space-y-4">
          <div>
            <label htmlFor="venue_name" className="block text-sm font-medium text-gray-700 mb-1">
              Venue / Facility Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="venue_name"
              name="venue_name"
              value={form.venue_name}
              onChange={handleChange}
              placeholder="e.g. Acme Corp. Office, Community Center"
              className={[
                "block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500",
                fieldErrors.venue_name ? "border-red-400" : "border-gray-300",
              ].join(" ")}
            />
            {fieldErrors.venue_name && (
              <p className="text-red-500 text-xs mt-1">{fieldErrors.venue_name}</p>
            )}
          </div>

          <div>
            <label htmlFor="venue_address" className="block text-sm font-medium text-gray-700 mb-1">
              Street Address <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="venue_address"
              name="venue_address"
              value={form.venue_address}
              onChange={handleChange}
              placeholder="123 Main St"
              className={[
                "block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500",
                fieldErrors.venue_address ? "border-red-400" : "border-gray-300",
              ].join(" ")}
            />
            {fieldErrors.venue_address && (
              <p className="text-red-500 text-xs mt-1">{fieldErrors.venue_address}</p>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="venue_city" className="block text-sm font-medium text-gray-700 mb-1">
                City <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="venue_city"
                name="venue_city"
                value={form.venue_city}
                onChange={handleChange}
                placeholder="Tampa"
                className={[
                  "block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500",
                  fieldErrors.venue_city ? "border-red-400" : "border-gray-300",
                ].join(" ")}
              />
              {fieldErrors.venue_city && (
                <p className="text-red-500 text-xs mt-1">{fieldErrors.venue_city}</p>
              )}
            </div>

            <div>
              <label htmlFor="venue_state" className="block text-sm font-medium text-gray-700 mb-1">
                State <span className="text-red-500">*</span>
              </label>
              <select
                id="venue_state"
                name="venue_state"
                value={form.venue_state}
                onChange={handleChange}
                className={[
                  "block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500",
                  fieldErrors.venue_state ? "border-red-400" : "border-gray-300",
                ].join(" ")}
              >
                <option value="">State</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {fieldErrors.venue_state && (
                <p className="text-red-500 text-xs mt-1">{fieldErrors.venue_state}</p>
              )}
            </div>

            <div>
              <label htmlFor="venue_zip" className="block text-sm font-medium text-gray-700 mb-1">
                ZIP <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="venue_zip"
                name="venue_zip"
                value={form.venue_zip}
                onChange={handleChange}
                placeholder="33602"
                maxLength={10}
                className={[
                  "block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500",
                  fieldErrors.venue_zip ? "border-red-400" : "border-gray-300",
                ].join(" ")}
              />
              {fieldErrors.venue_zip && (
                <p className="text-red-500 text-xs mt-1">{fieldErrors.venue_zip}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Additional notes */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Additional Notes</h2>
        <textarea
          id="notes"
          name="notes"
          value={form.notes}
          onChange={handleChange}
          rows={4}
          maxLength={500}
          placeholder="Anything else we should know? (optional)"
          className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-y"
        />
        <p className="text-xs text-gray-400 mt-1 text-right">{form.notes.length}/500</p>
      </section>

      {/* Fee callout */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
        <span className="text-amber-600 text-lg leading-none mt-0.5">ℹ️</span>
        <p className="text-sm text-amber-800">
          A <strong>$65 travel &amp; setup fee</strong> is applied to all customer-requested classes.
          This is a flat fee in addition to the per-student class price.
        </p>
      </div>

      {submitError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{submitError}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full sm:w-auto bg-red-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Submitting…" : "Submit Class Request"}
      </button>
    </form>
  );
}
