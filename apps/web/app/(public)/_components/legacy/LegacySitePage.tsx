"use client";

/**
 * LegacySitePage
 * Single-page clone of the original superherocpr.com WordPress site.
 * Used by: app/(public)/page.tsx when system_settings.legacy_site_enabled === "true".
 *
 * Sections (in order, matching the original site):
 *   1. Hero — headline, Book Now CTA, phone link
 *   2. Features grid — 6 value-prop cards
 *   3. Testimonials — Holly Duncan RN quote with Facebook link
 *   4. Protect Your Loved Ones — cardiac-arrest stat + CTA
 *   5. Contact form — Name / Email / Phone → POST /api/contact
 *
 * Styling uses the modern app's Tailwind design system (red accent, gray scale,
 * dark mode variants) — the goal is matching the original content/sections, not
 * the WordPress visual style.
 *
 * Image assets are loaded from /images/legacy/* (placed in apps/web/public/images/legacy/).
 * Missing images render with alt text only; the page still functions.
 */

import { useState } from "react";
import Image from "next/image";
import CaptchaCheckbox from "@/components/CaptchaCheckbox";
import TurnstileWidget from "@/components/TurnstileWidget";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
import {
  Heart,
  Clock,
  GraduationCap,
  CreditCard,
  Wrench,
  Award,
  CheckCircle,
  AlertCircle,
  Phone,
  Mail,
} from "lucide-react";

/**
 * Inline Facebook "f" logo — lucide-react no longer ships a Facebook icon,
 * so we render the brand mark directly. Sized via the className prop.
 */
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 4.99 3.66 9.13 8.44 9.94v-7.03H7.9v-2.91h2.54V9.84c0-2.52 1.49-3.91 3.78-3.91 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.44 2.91h-2.34V22c4.78-.81 8.43-4.95 8.43-9.94z" />
    </svg>
  );
}

/** Business phone number — also used as the tel: link target. */
const BUSINESS_PHONE_DISPLAY = "(813) 966-3969";
const BUSINESS_PHONE_TEL = "+18139663969";
/** Business email shown in the Book Your Date section. */
const BUSINESS_EMAIL = "Book@SuperheroCPR.com";
/** Public Facebook page linked from the testimonials section. */
const FACEBOOK_URL =
  "https://www.facebook.com/Super-Hero-CPR-298899580537162/";

/** A single value-prop card rendered in the features grid. */
interface FeatureCard {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}

/** The six feature cards from the original site, in display order. */
const FEATURE_CARDS: FeatureCard[] = [
  {
    icon: Heart,
    title: "The Knowledge You Need To Save A Life",
    body:
      "Everything you are is stored in your human brain. Two to three minutes without blood oxygen to your brain and that precious brain begins to die. Learning to apply high quality CPR gives you the knowledge you need to save a life, taught by professionals on the front line of today's Fire, EMS, and ER response.",
  },
  {
    icon: Clock,
    title: "Flexible Learning Options",
    body:
      "Learn from the comfort of your home or office. Schedule for the morning, early afternoon, or evening according to your busy work schedule. Weekdays and weekend availability, including most holidays.",
  },
  {
    icon: GraduationCap,
    title: "Up To Date Training",
    body:
      "Receive training based on the very latest American Heart Association standards, from those on the front line of cardiac care today.",
  },
  {
    icon: CreditCard,
    title: "Easy & Safe Payments",
    body: "Pay using cash, credit, or check. Whatever's easiest for you.",
  },
  {
    icon: Wrench,
    title: "Modern Learning Tools",
    body:
      "Modern training tools at your disposal: manikins, AEDs, and the latest practice equipment.",
  },
  {
    icon: Award,
    title: "Certified AHA Teacher",
    body:
      "Book confidently knowing you are receiving American Heart Association instruction and certification.",
  },
];

/** Local form state for the contact form. */
interface ContactFormState {
  name: string;
  email: string;
  phone: string;
}

/** Submission status displayed below the contact form. */
type SubmitStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

/** Tailwind input classes — matches the modern app's input styling. */
const inputClass =
  "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 text-sm " +
  "text-gray-900 dark:text-white bg-white dark:bg-gray-800 placeholder:text-gray-400 " +
  "focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent";

/**
 * Renders the full legacy single-page site.
 * Returns the page content only — PublicHeader/PublicFooter are provided by
 * the public layout, so this component does not render its own shell.
 */
export default function LegacySitePage() {
  // ── Contact form state ─────────────────────────────────────────────────────
  const [form, setForm] = useState<ContactFormState>({
    name: "",
    email: "",
    phone: "",
  });
  const [status, setStatus] = useState<SubmitStatus>({ kind: "idle" });
  // Captcha state — Turnstile token when keys are set, simple boolean otherwise.
  const [captchaChecked, setCaptchaChecked] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  /**
   * Submits the contact form to POST /api/contact.
   * The legacy form only collects name/email/phone, so we send a fixed
   * inquiryType and message so the existing contact endpoint accepts it.
   */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "submitting") return;

    // Client-side guard — the API revalidates these
    if (!form.name.trim() || !form.email.trim() || !form.phone.trim()) {
      setStatus({ kind: "error", message: "Please fill in all fields." });
      return;
    }

    // Require the captcha to be completed before submitting.
    if (TURNSTILE_SITE_KEY ? !captchaToken : !captchaChecked) {
      setStatus({ kind: "error", message: "Please check the \"I'm not a robot\" box." });
      return;
    }

    setStatus({ kind: "submitting" });

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          inquiryType: "Booking Inquiry",
          message:
            "Booking inquiry submitted via the legacy home page. " +
            "Please contact this person to schedule a CPR class.",
          captchaToken: captchaToken ?? "human-checked",
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        setStatus({
          kind: "error",
          message:
            (data?.error as string) ??
            "Something went wrong. Please call us instead.",
        });
        return;
      }

      setStatus({
        kind: "success",
        message: "Thanks! We'll be in touch shortly to schedule your class.",
      });
      setForm({ name: "", email: "", phone: "" });
    } catch {
      setStatus({
        kind: "error",
        message: "Network error. Please try again or call us directly.",
      });
    }
  }

  return (
    <div className="bg-white dark:bg-gray-950">
      {/* Hide the shared footer's Quick Links column on the legacy home page only.
          Scoped via id selector so it has zero effect on any other route. */}
      <style>{`#footer-quick-links { display: none !important; }`}</style>
      {/* ── 1. Hero ───────────────────────────────────────────────────────── */}
      <section className="relative bg-gradient-to-br from-red-700 via-red-600 to-red-800 text-white overflow-hidden">
        {/* Decorative background image — optional, falls back to gradient if missing */}
        <div className="absolute inset-0 opacity-20">
          <Image
            src="/images/legacy/hero-bg.jpg"
            alt=""
            fill
            priority
            className="object-cover"
            // If the asset doesn't exist yet, Next/Image will log a 404 but the gradient still shows
          />
        </div>
        <div className="relative max-w-5xl mx-auto px-6 py-24 sm:py-32 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
            Book Your CPR License And Renewal Class Now Online!
          </h1>
          <p className="text-lg sm:text-xl text-red-50 max-w-3xl mx-auto mb-10">
            Click below to schedule your CPR License and Renewal Classes.
            On-location classes available.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {/* Anchor links scroll smoothly to the in-page contact form (#contact) rather than navigating away */}
            <a
              href="#contact"
              className="inline-flex items-center justify-center bg-white text-red-700 hover:bg-red-50 font-bold px-8 py-4 rounded-lg shadow-lg transition-colors text-lg"
            >
              Book Now
            </a>
            <a
              href={`tel:${BUSINESS_PHONE_TEL}`}
              className="inline-flex items-center justify-center gap-2 bg-red-900/40 hover:bg-red-900/60 border border-white/30 text-white font-semibold px-8 py-4 rounded-lg transition-colors text-lg"
            >
              <Phone className="w-5 h-5" />
              {BUSINESS_PHONE_DISPLAY}
            </a>
          </div>
        </div>
      </section>

      {/* ── 2. Features grid ──────────────────────────────────────────────── */}
      {/* id="why-choose-us" — header "Why Choose Us" link scrolls here in legacy mode */}
      <section id="why-choose-us" className="py-20 sm:py-24 bg-gray-50 dark:bg-gray-900 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              CPR License And Renewal Classes
            </h2>
            <p className="text-base text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
              Real-world instruction from someone who&apos;s been on the front line,
              so you walk away ready to act when it matters.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 hover:shadow-md transition-shadow"
                >
                  <div className="w-12 h-12 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-red-600 dark:text-red-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    {card.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                    {card.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 3. Testimonials ───────────────────────────────────────────────── */}
      <section className="py-20 sm:py-24 bg-white dark:bg-gray-950">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Testimonials
            </h2>
            <p className="text-base text-gray-600 dark:text-gray-300">
              See what others are saying about Superhero CPR.
            </p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-8 sm:p-10">
            <div className="flex flex-col sm:flex-row gap-6 items-start">
              <div className="shrink-0">
                <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 relative">
                  <Image
                    src="/images/legacy/testimonial-photo.jpg"
                    alt="Super Hero CPR customer review"
                    fill
                    className="object-cover"
                  />
                </div>
              </div>
              <div className="flex-1">
                <blockquote className="text-base sm:text-lg text-gray-800 dark:text-gray-200 italic leading-relaxed mb-4">
                  &ldquo;I have been CPR certified for 40 consecutive years.
                  That&apos;s a LOT of CPR classes. The absolute best class I ever
                  attended was yours, last week at Casa Mora. Your teaching
                  style combined with your knowledge and love of the material
                  created a positive learning experience for us all. It is so
                  obvious that saving lives is your passion as well as enabling
                  others to do so. Thanks so much for your commitment in
                  delivering an excellent CPR class.&rdquo;
                </blockquote>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  Holly Duncan, RN, BSN
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Casa Mora Rehabilitation &amp; Extended Care
                </p>
              </div>
            </div>
            <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
              <a
                href={FACEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-semibold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              >
                <FacebookIcon className="w-4 h-4" />
                Add a testimonial on Facebook
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. Protect Your Loved Ones ────────────────────────────────────── */}
      <section className="py-20 sm:py-24 bg-gray-900 dark:bg-black text-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">
            Protect Your Loved Ones.
          </h2>
          <p className="text-lg text-gray-200 mb-8 max-w-2xl mx-auto">
            70–80% of all cardiac arrests happen at home. Please schedule a
            class so you and your loved ones know what to do in a sudden
            cardiac emergency.
          </p>
          {/* Anchor scrolls to the in-page contact form (#contact) below */}
          <a
            href="#contact"
            className="inline-flex items-center justify-center bg-red-600 hover:bg-red-700 text-white font-bold px-8 py-4 rounded-lg shadow-lg transition-colors text-lg"
          >
            Schedule a Class
          </a>
        </div>
      </section>

      {/* ── 5. Contact / Booking form ─────────────────────────────────────── */}
      {/* id="contact" — Book Now / Schedule a Class hero CTAs scroll here via #contact */}
      <section id="contact" className="py-20 sm:py-24 bg-white dark:bg-gray-950 scroll-mt-20">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Book Your Date Before Classes Fill!
            </h2>
            <p className="text-base text-gray-600 dark:text-gray-300 mb-6">
              Give us a call, send us an email, or fill out the form below.
              Your CPR certification class is only one click away.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm">
              <a
                href={`tel:${BUSINESS_PHONE_TEL}`}
                className="inline-flex items-center gap-2 font-semibold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              >
                <Phone className="w-4 h-4" />
                {BUSINESS_PHONE_DISPLAY}
              </a>
              <span className="text-gray-300 dark:text-gray-700 hidden sm:inline">
                ·
              </span>
              <a
                href={`mailto:${BUSINESS_EMAIL}`}
                className="inline-flex items-center gap-2 font-semibold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              >
                <Mail className="w-4 h-4" />
                {BUSINESS_EMAIL}
              </a>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 sm:p-8 space-y-4"
            noValidate
          >
            <div>
              <label
                htmlFor="legacy-name"
                className="block text-sm font-semibold text-gray-900 dark:text-white mb-1.5"
              >
                Name <span className="text-red-600">*</span>
              </label>
              <input
                id="legacy-name"
                type="text"
                required
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
                placeholder="Your full name"
              />
            </div>

            <div>
              <label
                htmlFor="legacy-email"
                className="block text-sm font-semibold text-gray-900 dark:text-white mb-1.5"
              >
                Email <span className="text-red-600">*</span>
              </label>
              <input
                id="legacy-email"
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputClass}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="legacy-phone"
                className="block text-sm font-semibold text-gray-900 dark:text-white mb-1.5"
              >
                Phone Number <span className="text-red-600">*</span>
              </label>
              <input
                id="legacy-phone"
                type="tel"
                required
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={inputClass}
                placeholder="(555) 555-5555"
              />
            </div>

            {/* Captcha — Turnstile when keys are set, simple checkbox otherwise */}
            {TURNSTILE_SITE_KEY ? (
              <TurnstileWidget
                siteKey={TURNSTILE_SITE_KEY}
                onVerify={(token) => setCaptchaToken(token)}
                onExpire={() => setCaptchaToken(null)}
              />
            ) : (
              <CaptchaCheckbox
                checked={captchaChecked}
                onChange={setCaptchaChecked}
              />
            )}

            <button
              type="submit"
              disabled={status.kind === "submitting"}
              className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
            >
              {status.kind === "submitting" ? "Submitting…" : "Submit"}
            </button>

            {/* Inline status feedback — success or error */}
            {status.kind === "success" && (
              <div className="flex items-start gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{status.message}</span>
              </div>
            )}
            {status.kind === "error" && (
              <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{status.message}</span>
              </div>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}
