/**
 * /terms — User Agreement (Terms of Service) page.
 * Required by PayPal's "Log in with PayPal" app review process.
 * Covers the terms under which customers and instructors use SuperHeroCPR services.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "User Agreement",
  description:
    "SuperHeroCPR user agreement — terms and conditions for booking and attending CPR classes.",
};

/** Renders the User Agreement / Terms of Service page. */
export default function UserAgreementPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">User Agreement</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: May 30, 2026</p>

      <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
          <p>
            By accessing or using the SuperHeroCPR website at{" "}
            <a href="https://superherocpr.com" className="text-blue-600 underline">
              superherocpr.com
            </a>{" "}
            (&ldquo;Site&rdquo;) or booking any class, you agree to be bound by these Terms. If you
            do not agree, please do not use our Site or services.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Our Services</h2>
          <p>
            SuperHeroCPR offers in-person CPR, BLS (Basic Life Support), and First Aid training
            classes certified by the American Heart Association (&ldquo;AHA&rdquo;). All classes are
            taught by licensed AHA instructors and held at physical locations. No online-only
            certification is offered or implied.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Booking and Payment</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Class bookings are confirmed only after full payment or an accepted invoice has
              been received.
            </li>
            <li>
              Prices are stated in U.S. dollars and are subject to change. The price shown at
              the time of booking is the price you pay.
            </li>
            <li>
              Payments are processed through PayPal. By completing a payment, you also agree to
              PayPal&apos;s{" "}
              <a href="https://www.paypal.com/us/legalhub/useragreement-full" className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">
                User Agreement
              </a>
              .
            </li>
            <li>
              Invoices sent to organizations or groups are due within the timeframe stated on
              the invoice.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Cancellations and Refunds</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              If you cancel at least 48 hours before your scheduled class, you will receive a
              full refund or may reschedule at no charge.
            </li>
            <li>
              Cancellations made less than 48 hours before class are not eligible for a refund
              but may be rescheduled once at our discretion.
            </li>
            <li>
              If SuperHeroCPR cancels or reschedules a class, you will be offered a full refund
              or the option to transfer to another available date.
            </li>
            <li>
              No-shows are not eligible for a refund.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Class Attendance and Certification</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              You must attend the full class to receive an AHA certification card. Partial
              attendance does not qualify for certification.
            </li>
            <li>
              You must provide accurate name and date of birth information for your certification
              record. AHA requires this information to issue a valid card.
            </li>
            <li>
              Certification cards are issued by the AHA, not by SuperHeroCPR. Issuance timelines
              are subject to AHA processing.
            </li>
            <li>
              AHA certifications are typically valid for two years from the date of issue.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Health and Safety</h2>
          <p>
            CPR training involves physical activity including chest compressions on a mannequin.
            By booking a class, you confirm that you are physically able to participate. If you
            have any health concerns, consult a physician before attending. SuperHeroCPR is not
            liable for injury resulting from participation in training activities.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">7. User Accounts</h2>
          <p>
            If you create an account on our Site, you are responsible for maintaining the
            confidentiality of your login credentials and for all activity under your account.
            You agree to notify us immediately if you suspect unauthorized access. We reserve
            the right to terminate accounts that violate these Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Instructor Accounts</h2>
          <p>
            Instructors who connect a PayPal account through our platform authorize SuperHeroCPR
            to initiate invoice payments on their behalf to students. Instructors are responsible
            for ensuring their PayPal account is active, in good standing, and able to receive
            payments. SuperHeroCPR is not responsible for payment failures caused by issues with
            an instructor&apos;s PayPal account.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Intellectual Property</h2>
          <p>
            All content on this Site — including text, images, logos, and course materials — is
            owned by or licensed to SuperHeroCPR. You may not reproduce, distribute, or create
            derivative works from our content without written permission.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Limitation of Liability</h2>
          <p>
            To the fullest extent permitted by law, SuperHeroCPR shall not be liable for any
            indirect, incidental, or consequential damages arising from your use of our Site or
            services. Our total liability to you for any claim shall not exceed the amount you
            paid for the specific class giving rise to the claim.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Disclaimer</h2>
          <p>
            CPR and first aid training provided by SuperHeroCPR is educational in nature. Completion
            of a course does not guarantee that you will be able to successfully perform CPR or
            first aid in an emergency. SuperHeroCPR makes no warranties about the outcomes of
            applying learned skills in real-world situations.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">12. Governing Law</h2>
          <p>
            These Terms are governed by the laws of the State of Florida, without regard to its
            conflict of law provisions. Any disputes arising from these Terms shall be resolved
            in the courts of Florida.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">13. Changes to These Terms</h2>
          <p>
            We may update these Terms from time to time. When we do, we will update the
            &ldquo;Last updated&rdquo; date at the top of this page. Continued use of our Site or
            services after changes are posted constitutes your acceptance of the updated Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">14. Contact Us</h2>
          <p>
            If you have questions about these Terms, please contact us at:
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
