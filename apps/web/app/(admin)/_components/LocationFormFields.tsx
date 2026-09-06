"use client";

/**
 * LocationFormFields: reusable labeled inputs for a location form.
 * Also exports the shared LocationFormState type, US_STATES list,
 * blank-form factory, and validation helper.
 * Used by: LocationsClient (inline edit), AddLocationPanel (add flow).
 */

// ── Types & constants ──────────────────────────────────────────────────────────

/** Form field values for creating or editing a location. */
export interface LocationFormState {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
}

/** Full list of US state abbreviations used in the state selector. */
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

/**
 * Returns a blank LocationFormState with all fields empty.
 */
export function blankLocationForm(): LocationFormState {
  return { name: "", address: "", city: "", state: "", zip: "", notes: "" };
}

/**
 * Validates a LocationFormState. Returns a map of field → error message
 * for any field that fails. Empty object means valid.
 * @param f - Form values to validate.
 */
export function validateLocationForm(
  f: LocationFormState
): Partial<Record<keyof LocationFormState, string>> {
  const errors: Partial<Record<keyof LocationFormState, string>> = {};
  if (!f.name.trim()) errors.name = "Name is required.";
  if (!f.address.trim()) errors.address = "Address is required.";
  if (!f.city.trim()) errors.city = "City is required.";
  if (!f.state) errors.state = "State is required.";
  if (!f.zip.trim()) errors.zip = "Zip code is required.";
  return errors;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface LocationFormFieldsProps {
  form: LocationFormState;
  errors: Partial<Record<keyof LocationFormState, string>>;
  /** Called on any field change: receives field key and new string value. */
  onChange: (field: keyof LocationFormState, value: string) => void;
  /** Prefix for element IDs to prevent collisions when used multiple times per page. */
  idPrefix: string;
}

/**
 * Renders the complete set of labeled inputs for a location form:
 * name, street address, city/state/zip grid, and optional notes.
 * @param form - Current field values.
 * @param errors - Per-field validation error messages.
 * @param onChange - Field change handler.
 * @param idPrefix - ID prefix for accessibility label association.
 */
export default function LocationFormFields({
  form,
  errors,
  onChange,
  idPrefix,
}: LocationFormFieldsProps) {
  /**
   * Renders a labeled text input for one form field.
   * @param name - Field key.
   * @param label - Visible label text.
   * @param required - Whether to show the red asterisk (default true).
   */
  const field = (
    name: keyof LocationFormState,
    label: string,
    required = true
  ) => (
    <div>
      <label
        htmlFor={`${idPrefix}-${name}`}
        className="mb-1 block text-xs font-medium text-gray-700"
      >
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        id={`${idPrefix}-${name}`}
        type="text"
        value={form[name]}
        onChange={(e) => onChange(name, e.target.value)}
        className={`w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 ${
          errors[name]
            ? "border-red-400 focus:border-red-400"
            : "border-gray-300 focus:border-red-500"
        }`}
      />
      {errors[name] && (
        <p className="mt-0.5 text-xs text-red-600">{errors[name]}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {field("name", "Location Name")}
      {field("address", "Street Address")}
      <div className="grid grid-cols-3 gap-3">
        {field("city", "City")}
        <div>
          <label
            htmlFor={`${idPrefix}-state`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            State<span className="ml-0.5 text-red-500">*</span>
          </label>
          <select
            id={`${idPrefix}-state`}
            value={form.state}
            onChange={(e) => onChange("state", e.target.value)}
            className={`w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 ${
              errors.state
                ? "border-red-400 focus:border-red-400"
                : "border-gray-300 focus:border-red-500"
            }`}
          >
            <option value="">-</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {errors.state && (
            <p className="mt-0.5 text-xs text-red-600">{errors.state}</p>
          )}
        </div>
        {field("zip", "Zip")}
      </div>
      <div>
        <label
          htmlFor={`${idPrefix}-notes`}
          className="mb-1 block text-xs font-medium text-gray-700"
        >
          Notes
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          rows={2}
          value={form.notes}
          onChange={(e) => onChange("notes", e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
      </div>
    </div>
  );
}
