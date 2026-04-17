"use client";

/**
 * ContactSection — two-column contact info + form section on the /contact page.
 * Client component — manages form state, submit/success/error flows.
 * DB writes and email sends happen server-side in app/api/contact/route.ts.
 * Used by: app/(public)/contact/page.tsx
 */

import { useState } from "react";
import { Phone, Mail, MapPin } from "lucide-react";

const INQUIRY_TYPES = [
  "General Question",
  "Group Booking (5+ people)",
  "Corporate / Workplace Training",
  "Certification Renewal",
  "Other",
] as const;

interface FormData {
  name: string;
  email: string;
  phone: string;
  inquiryType: string;
  message: string;
}

const EMPTY_FORM: FormData = {
  name: "",
  email: "",
  phone: "",
  inquiryType: "",
  message: "",
};

/**
 * Renders the contact info column (phone, email, service area) and the
 * contact form with submit / success / error states.
 */
export default function ContactSection() {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleChange(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        throw new Error("Non-2xx response from /api/contact");
      }

      setSubmitted(true);
    } catch {
      setSubmitError(
        "Something went wrong. Please try again or email us directly at info@superherocpr.com"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const firstName = form.name.trim().split(" ")[0] || "there";

  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">

        {/* ---- Contact info ---- */}
        <div className="flex flex-col gap-8">
          <ContactInfoRow
            icon={<Phone className="text-red-600 shrink-0" size={22} aria-hidden="true" />}
            label="Call Us"
          >
            <a
              href="tel:+18139663969"
              className="text-gray-700 hover:text-red-600 transition-colors duration-150 font-medium"
            >
              (813) 966-3969
            </a>
          </ContactInfoRow>

          <ContactInfoRow
            icon={<Mail className="text-red-600 shrink-0" size={22} aria-hidden="true" />}
            label="Email Us"
          >
            <a
              href="mailto:info@superherocpr.com"
              className="text-gray-700 hover:text-red-600 transition-colors duration-150 font-medium break-all"
            >
              info@superherocpr.com
            </a>
            <p className="text-sm text-gray-500 mt-1">
              We typically respond within 1 business day.
            </p>
          </ContactInfoRow>

          <ContactInfoRow
            icon={<MapPin className="text-red-600 shrink-0" size={22} aria-hidden="true" />}
            label="Service Area"
          >
            <p className="text-gray-700 leading-relaxed">
              We serve the greater Tampa Bay area including Tampa, St.
              Petersburg, Clearwater, Brandon, and surrounding communities.
            </p>
          </ContactInfoRow>
        </div>

        {/* ---- Contact form / success state ---- */}
        <div>
          {submitted ? (
            <div className="flex flex-col gap-3 py-8">
              <h2 className="text-xl font-bold text-gray-900">Message sent!</h2>
              <p className="text-gray-600 leading-relaxed">
                Thanks for reaching out, {firstName}. We'll get back to you at{" "}
                <span className="font-medium">{form.email}</span> within 1
                business day.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
              {/* Full name */}
              <FormField label="Full Name" id="contact-name" required>
                <input
                  id="contact-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={form.name}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </FormField>

              {/* Email */}
              <FormField label="Email" id="contact-email" required>
                <input
                  id="contact-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </FormField>

              {/* Phone (optional) */}
              <FormField label="Phone" id="contact-phone">
                <input
                  id="contact-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </FormField>

              {/* Inquiry type */}
              <FormField label="Inquiry Type" id="contact-inquiry" required>
                <select
                  id="contact-inquiry"
                  name="inquiryType"
                  required
                  value={form.inquiryType}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {INQUIRY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </FormField>

              {/* Message */}
              <FormField label="Message" id="contact-message" required>
                <textarea
                  id="contact-message"
                  name="message"
                  required
                  rows={5}
                  value={form.message}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-y min-h-[120px]"
                />
              </FormField>

              {/* Error message */}
              {submitError && (
                <p className="text-sm text-red-600 leading-relaxed" role="alert">
                  {submitError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                {submitting ? "Sending…" : "Send Message"}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Small layout helper — not exported (only used in this file) ──────────────

interface ContactInfoRowProps {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}

/** Renders one contact method row with icon, bold label, and child content. */
function ContactInfoRow({ icon, label, children }: ContactInfoRowProps) {
  return (
    <div className="flex items-start gap-4">
      <div className="mt-0.5">{icon}</div>
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}

interface FormFieldProps {
  label: string;
  id: string;
  required?: boolean;
  children: React.ReactNode;
}

/** Wraps a form control with its label. */
function FormField({ label, id, required, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
        {required && (
          <span className="text-red-600 ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}
