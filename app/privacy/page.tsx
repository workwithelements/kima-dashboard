import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy | KIMA by Elements",
  description: "Privacy policy for KIMA, a performance marketing dashboard by Elements.",
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-300">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-2 text-3xl font-bold text-white">Privacy Policy</h1>
        <p className="mb-10 text-sm text-neutral-500">Last updated: 8 March 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">1. Introduction</h2>
            <p>
              KIMA is a performance marketing dashboard operated by Elements ("we", "us", "our").
              This Privacy Policy explains how we collect, use, and protect information when you use
              the KIMA platform at kimadash.netlify.app.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">2. Information We Collect</h2>
            <p className="mb-3">We collect and process the following categories of information:</p>
            <ul className="ml-4 list-disc space-y-2">
              <li>
                <strong className="text-neutral-200">Account Information:</strong> Email addresses
                and authentication credentials for team members who log in to the dashboard.
              </li>
              <li>
                <strong className="text-neutral-200">Advertising Platform Data:</strong> We retrieve
                aggregated advertising performance data (such as spend, impressions, clicks, and
                conversions) from connected platforms including Meta (Facebook/Instagram), Google Ads,
                Google Analytics, Google Search Console, and Shopify. This data is associated with
                advertising accounts, not individual end users.
              </li>
              <li>
                <strong className="text-neutral-200">Demographic &amp; Placement Data:</strong> We
                retrieve aggregated demographic breakdowns (age ranges, gender) and placement data
                (platform, position, device type) from Meta&apos;s Marketing API. This data is
                statistical and aggregated — it does not identify individual people.
              </li>
              <li>
                <strong className="text-neutral-200">Usage Data:</strong> Basic usage information
                such as pages visited within the dashboard and timestamps of access.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">3. How We Use Information</h2>
            <p className="mb-3">We use the information we collect to:</p>
            <ul className="ml-4 list-disc space-y-2">
              <li>Display advertising performance metrics and analytics to authorised users</li>
              <li>Provide budget pacing, reach analysis, and creative performance insights</li>
              <li>Authenticate users and manage access to the platform</li>
              <li>Improve and maintain the functionality of the dashboard</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">4. Data Storage &amp; Security</h2>
            <p>
              Data is stored securely using Supabase (hosted on AWS in the EU). We use row-level
              security policies to ensure clients can only access their own data. All connections
              are encrypted via TLS. Access to the dashboard requires authentication via email/password
              or a client-specific view password.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">5. Data Sharing</h2>
            <p>
              We do not sell, rent, or share personal information with third parties for their
              marketing purposes. Data is only shared with:
            </p>
            <ul className="ml-4 mt-3 list-disc space-y-2">
              <li>
                <strong className="text-neutral-200">Service Providers:</strong> Supabase (database
                hosting), Netlify (application hosting), and the advertising platforms from which
                data is retrieved (Meta, Google, Shopify).
              </li>
              <li>
                <strong className="text-neutral-200">Authorised Users:</strong> Team members and
                clients who have been granted access to specific account data.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">6. Data Retention</h2>
            <p>
              Advertising performance data is retained for as long as the client relationship is
              active. Account credentials and access logs are retained for the duration of the
              account. Data can be deleted upon request.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">7. Your Rights</h2>
            <p>
              Under applicable data protection laws (including GDPR and UK GDPR), you have the right
              to access, correct, delete, or export your personal data. You may also object to or
              restrict certain processing. To exercise these rights, contact us using the details below.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">8. Cookies</h2>
            <p>
              KIMA uses essential cookies only — specifically authentication cookies to maintain your
              login session and client view access. We do not use tracking cookies or third-party
              analytics cookies.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will be reflected on this
              page with an updated "Last updated" date.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">10. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy or wish to exercise your data rights,
              please contact us at:
            </p>
            <p className="mt-3">
              <strong className="text-neutral-200">Elements</strong>
              <br />
              Email:{" "}
              <a
                href="mailto:hello@workwithelements.com"
                className="text-[#CDFF00] hover:underline"
              >
                hello@workwithelements.com
              </a>
            </p>
          </section>
        </div>

        <div className="mt-16 border-t border-neutral-800 pt-6 text-center text-xs text-neutral-600">
          &copy; {new Date().getFullYear()} Elements. All rights reserved.
        </div>
      </div>
    </div>
  )
}
