// app/legal/refund/page.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Refund Policy | Sedifex',
  description:
    'Understand how billing, trials, and refunds work for Sedifex subscriptions.',
}

export default function RefundPage() {
  return (
    <main className="legal-page">
      <div className="legal-container">
        <header className="legal-header">
          <p className="legal-kicker">Legal</p>
          <h1 className="legal-title">Refund Policy</h1>
          <p className="legal-subtitle">
            This Refund Policy explains how trials, payments, and refunds work for your
            Sedifex subscription.
          </p>
          <p className="legal-meta">
            Last updated: {new Date().getFullYear()}
          </p>
        </header>

        <section className="legal-section">
          <h2>1. Trial period</h2>
          <p>
            New workspaces typically start with a <strong>free trial period</strong>.
            During this time you can explore Sedifex, add products, test sales, and
            decide whether the platform is a good fit for your business.
          </p>
          <p>
            The length of the trial and any limits (for example, features or number of
            users) may vary and will be shown in the app or on our pricing page when you
            sign up.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Moving from trial to a paid plan</h2>
          <p>
            When you choose to subscribe to Sedifex, you will be charged via our payment
            processor (currently <strong>Paystack</strong>) according to the plan,
            billing cycle (monthly or yearly), and currency shown at checkout.
          </p>
          <p>
            By confirming a payment, you agree to our Terms of Service and to this Refund
            Policy. The trial period is designed to give you enough time to evaluate
            Sedifex before any charge is made.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. No refunds after payment</h2>
          <p>
            Once a subscription charge has been successfully processed,{' '}
            <strong>payments are non-refundable</strong>.
          </p>
          <p>In particular:</p>
          <ul>
            <li>We do not offer refunds for unused time on a subscription period</li>
            <li>We do not offer refunds if you forget to cancel before renewal</li>
            <li>We do not offer refunds for differences in usage or activity</li>
          </ul>
          <p>
            Please use the free trial period to fully evaluate Sedifex and make sure it
            suits your needs before upgrading to a paid plan.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. Cancelling your subscription</h2>
          <p>
            You can cancel your subscription at any time from within your account or by
            contacting us. When you cancel:
          </p>
          <ul>
            <li>Your current paid period will continue until the end of its term</li>
            <li>
              You will <strong>not</strong> be charged again after the end of the current
              billing cycle, as long as the cancellation is processed before the next
              renewal date
            </li>
            <li>No refunds are issued for the remaining days in the current period</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>5. Billing issues and exceptional cases</h2>
          <p>
            If you believe there has been a billing error (for example, a duplicate
            charge), please contact us quickly with details of the issue so we can
            investigate.
          </p>
          <p>
            In rare situations, we may choose, at our sole discretion, to offer a
            courtesy credit or other adjustment. This does not create an obligation for
            future cases.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Changes to this Refund Policy</h2>
          <p>
            We may update this Refund Policy from time to time. When we do, we will
            update the &quot;Last updated&quot; date at the top of this page and may
            provide additional notice where appropriate (for example, via the app or by
            email).
          </p>
          <p>
            Any changes will apply to future subscription periods and new purchases,
            unless otherwise stated.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Contact us</h2>
          <p>If you have questions about billing or this Refund Policy, contact us:</p>
          <p>
            Email: <a href="mailto:sedifexbiz@gmail.com">sedifexbiz@gmail.com</a>
          </p>
          <p className="legal-disclaimer">
            This page is for information only and does not replace independent legal or
            financial advice. Please consult your own advisors if you have questions
            about how this policy applies to your business.
          </p>
        </section>
      </div>
    </main>
  )
}
