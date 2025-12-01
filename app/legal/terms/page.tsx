import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sedifex — Terms of Service",
  description:
    "Official Terms of Service for Sedifex POS, Inventory, and Business Management Platform, operated by Learn Language Education Academy.",
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold mb-6">Sedifex — Terms of Service</h1>
      <p className="text-sm text-gray-500 mb-8">
        Effective Date: {new Date().toLocaleDateString()}
        <br />
        Operated by: <strong>Learn Language Education Academy</strong>
        <br />
        Contact: <a href="mailto:sedifexbiz@gmail.com">sedifexbiz@gmail.com</a>
      </p>

      <section className="space-y-6 text-[15px] leading-7 text-gray-800">

        <p>
          Sedifex (“the Service”) is a cloud-based Point of Sale, inventory,
          expense, and business management platform developed by Felix Asadu
          and operated by Learn Language Education Academy. By creating an
          account or using Sedifex, you agree to the following Terms of
          Service.
        </p>

        <h2 className="text-xl font-semibold mt-10">1. Eligibility</h2>
        <p>
          You must be at least 18 years old and legally authorized to operate a
          business or act on behalf of one. By using Sedifex, you confirm that
          the information you provide is accurate.
        </p>

        <h2 className="text-xl font-semibold mt-10">2. Your Account</h2>
        <p>
          You are responsible for keeping your login credentials secure.
          Sedifex is not liable for unauthorized access caused by weak
          passwords, shared devices, or compromised staff accounts.
        </p>

        <h2 className="text-xl font-semibold mt-10">3. Services Provided</h2>
        <p>Sedifex provides the following tools:</p>
        <ul className="list-disc ml-6">
          <li>Point of Sale (POS)</li>
          <li>Inventory and stock management</li>
          <li>Sales and customer management</li>
          <li>Expenses and finance tracking</li>
          <li>Multi-device cloud synchronization</li>
          <li>Store directory listing (optional)</li>
          <li>Subscription billing (monthly or yearly)</li>
        </ul>

        <h2 className="text-xl font-semibold mt-10">4. Data Ownership</h2>
        <p>
          You own all data entered into Sedifex, including products, customers,
          sales, and expenses. We do not claim ownership of your business data.
          You grant us permission to store and process your data to operate the
          platform.
        </p>

        <h2 className="text-xl font-semibold mt-10">5. Payment & Billing</h2>
        <p>
          Sedifex offers monthly and yearly subscriptions through Paystack.
          Subscriptions renew automatically unless cancelled. You may cancel at
          any time, and cancellations prevent future charges.
        </p>

        <h2 className="text-xl font-semibold mt-10">6. Refund Policy</h2>
        <p>
          Sedifex does not offer automatic refunds for monthly or yearly
          subscriptions. Refunds may be granted manually at our discretion.
        </p>

        <h2 className="text-xl font-semibold mt-10">7. Acceptable Use</h2>
        <p>You agree not to use Sedifex for:</p>
        <ul className="list-disc ml-6">
          <li>Illegal or fraudulent business</li>
          <li>Uploading harmful or misleading data</li>
          <li>Interfering with platform stability or security</li>
          <li>Abusing free trials or creating fake workspaces</li>
        </ul>

        <h2 className="text-xl font-semibold mt-10">8. Public Store Directory</h2>
        <p>
          If you enable your store to appear on the Sedifex public directory,
          you are responsible for the accuracy of your store data. You may
          request its removal at any time.
        </p>

        <h2 className="text-xl font-semibold mt-10">9. Service Availability</h2>
        <p>
          We aim for high reliability but do not guarantee uninterrupted
          service. Scheduled maintenance, outages, or technical issues may
          occur. We are not liable for losses caused by downtime.
        </p>

        <h2 className="text-xl font-semibold mt-10">10. Termination</h2>
        <p>
          We may suspend or terminate accounts that violate the Terms or fail
          to pay subscription fees. You may export your data before closing
          your account.
        </p>

        <h2 className="text-xl font-semibold mt-10">
          11. Limitation of Liability
        </h2>
        <p>
          Sedifex is provided “as-is.” To the fullest extent permitted by law,
          our liability is limited to the amount paid in the previous 30 days.
        </p>

        <h2 className="text-xl font-semibold mt-10">12. Changes to Terms</h2>
        <p>
          We may update these Terms periodically. Continued use of the Service
          indicates acceptance of the updated Terms.
        </p>

        <h2 className="text-xl font-semibold mt-10">13. Contact</h2>
        <p>
          For questions, support, or legal concerns:{" "}
          <a className="underline" href="mailto:sedifexbiz@gmail.com">
            sedifexbiz@gmail.com
          </a>
        </p>
      </section>
    </main>
  )
}
