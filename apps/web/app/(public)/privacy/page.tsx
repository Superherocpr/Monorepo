/**
 * /privacy — Privacy Policy page.
 * Required by PayPal's "Log in with PayPal" app review process.
 * Covers data collected, how it is used, and customer rights.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "SuperHeroCPR privacy policy — how we collect, use, and protect your personal information.",
};

/** Renders the Privacy Policy page. */
export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: May 30, 2026</p>

      <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Who We Are</h2>
          <p>
            SuperHeroCPR (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) provides in-person CPR, BLS, and First Aid
            training classes certified by the American Heart Association. Our website is{" "}
            <a href="https://superherocpr.com" className="text-blue-600 underline">
              superherocpr.com
            </a>
            . You can reach us at{" "}
            <a href="mailto:info@superherocpr.com" className="text-blue-600 underline">
              info@superherocpr.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
          <p>We collect information you provide directly when you:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Book a CPR class (name, email address, phone number)</li>
            <li>Create an account on our site (email address, password)</li>
            <li>Complete a class roster (name, date of birth, address — required for AHA certification issuance)</li>
            <li>Contact us through our contact form (name, email, message)</li>
            <li>Connect a PayPal account as an instructor to receive invoice payments (PayPal account ID)</li>
          </ul>
          <p className="mt-3">
            We also collect limited technical information automatically, such as your IP address, browser
            type, and pages visited, through standard web server logs and analytics.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">3. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Process your class booking and confirm your registration</li>
            <li>Issue your AHA certification upon class completion</li>
            <li>Send transactional emails (booking confirmations, certification delivery, invoices)</li>
            <li>Respond to your inquiries and support requests</li>
            <li>Process instructor invoice payments through PayPal</li>
            <li>Improve our website and class offerings</li>
          </ul>
          <p className="mt-3">
            We do not use your personal information for advertising or sell it to third parties.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Sharing Your Information</h2>
          <p>We share your information only in the following circumstances:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              <strong>American Heart Association:</strong> Roster data (name, date of birth) is submitted
              to the AHA to issue your certification card.
            </li>
            <li>
              <strong>PayPal:</strong> When you pay for a class via invoice or when an instructor connects
              their PayPal account, we exchange data with PayPal as required to process that transaction.
              PayPal&apos;s privacy policy is available at{" "}
              <a href="https://www.paypal.com/us/legalhub/privacy-full" className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">
                paypal.com/us/legalhub/privacy-full
              </a>
              .
            </li>
            <li>
              <strong>Service providers:</strong> We use trusted service providers (database hosting,
              transactional email) who process data on our behalf under confidentiality agreements.
            </li>
            <li>
              <strong>Legal requirements:</strong> We may disclose information if required by law or to
              protect the rights and safety of our users or the public.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Retention</h2>
          <p>
            We retain booking and roster records for as long as necessary to support certification
            verification and comply with legal obligations. You may request deletion of your account
            and associated data at any time by contacting us at{" "}
            <a href="mailto:info@superherocpr.com" className="text-blue-600 underline">
              info@superherocpr.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Cookies</h2>
          <p>
            Our website uses essential cookies to maintain your login session and protect against
            cross-site request forgery (CSRF). We do not use advertising or tracking cookies.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Security</h2>
          <p>
            We use industry-standard security measures including encrypted connections (HTTPS),
            encrypted storage of payment tokens, and access controls to protect your data. No
            method of transmission over the internet is 100% secure, but we take reasonable steps
            to protect your information.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Your Rights</h2>
          <p>You have the right to:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Access the personal information we hold about you</li>
            <li>Request correction of inaccurate information</li>
            <li>Request deletion of your account and personal data</li>
            <li>Opt out of non-transactional communications</li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, contact us at{" "}
            <a href="mailto:info@superherocpr.com" className="text-blue-600 underline">
              info@superherocpr.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Children&apos;s Privacy</h2>
          <p>
            Our website and services are not directed at children under 13. We do not knowingly
            collect personal information from children under 13. If you believe we have inadvertently
            collected such information, please contact us immediately.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. When we do, we will update the
            &ldquo;Last updated&rdquo; date at the top of this page. Continued use of our website after
            changes are posted constitutes your acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Contact Us</h2>
          <p>
            If you have questions or concerns about this Privacy Policy, please contact us at:
          </p>
          <address className="not-italic mt-2">
            <strong>SuperHeroCPR</strong><br />
            <a href="mailto:info@superherocpr.com" className="text-blue-600 underline">
              info@superherocpr.com
            </a>
          </address>
        </section>

      </div>
    </div>
  );
}
