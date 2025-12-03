export default function RefundPage() {
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <main className="prose prose-slate mx-auto max-w-3xl px-4 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-violet-600">
        Legal
      </p>

      <h1 className="mb-2 text-3xl font-bold text-slate-900">
        Subscription &amp; Refund Policy
      </h1>

      <p className="mb-8 text-sm text-slate-500">Last updated: {today}</p>

      <p className="text-sm text-slate-500">
        This Subscription &amp; Refund Policy explains how billing, renewal and
        refunds work for your use of <strong>Sedifex</strong>, the POS,
        inventory and store-listing system operated by{" "}
        <strong>Learn Language Education Academy</strong>.
      </p>

      <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
        This policy is intended as a clear explanation of how payments work for
        Sedifex. It may not cover every situation under local law in every
        country. If you need specific legal advice, please consult a qualified
        professional in your jurisdiction.
      </p>

      {/* ------------------------- SECTION 1 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">1. Service description</h2>

        <p>Sedifex provides:</p>

        <ul>
          <li>
            A POS and inventory management system for small businesses,
            primarily in West Africa.
          </li>
          <li>
            A public store listing on <code>stores.sedifex.com</code>, where
            your products and services are displayed with your business contact
            details.
          </li>
          <li>
            Automatic syncing: updates you make in the app (such as adding or
            editing products or services) appear on{" "}
            <code>stores.sedifex.com</code>.
          </li>
          <li>
            Weekly reports sent to you so you can review your data and store
            performance.
          </li>
        </ul>

        <p>
          Sedifex itself <strong>does not collect or hold customer payments</strong> on your
          behalf. Customers pay you directly using your own payment methods and
          channels.
        </p>
      </section>

      {/* ------------------------- SECTION 2 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          2. Subscription plans and billing
        </h2>

        <ul>
          <li>
            Sedifex is offered on a <strong>monthly</strong> or{" "}
            <strong>yearly</strong> subscription basis.
          </li>
          <li>
            Subscription fees are charged <strong>in advance</strong> for each
            billing period.
          </li>
          <li>
            We currently process subscription payments using{" "}
            <strong>Paystack</strong> and may add other payment providers in the
            future.
          </li>
          <li>
            By providing your payment details, you authorise us and our payment
            provider to charge the subscription fee for each billing period.
          </li>
        </ul>
      </section>

      {/* ------------------------- SECTION 3 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">3. No refund policy</h2>

        <p>
          Because Sedifex provides immediate access to digital services,
          dashboards and tools once payment is confirmed:
        </p>

        <ul>
          <li>
            <strong>All subscription payments to Sedifex are non-refundable.</strong>
          </li>
          <li>
            We do not offer full or partial refunds if you stop using the
            service during a billing period.
          </li>
          <li>
            We do not refund payments if you forget to cancel before the renewal
            date.
          </li>
          <li>
            We do not refund payments because of changes in your business
            circumstances.
          </li>
        </ul>

        <p>
          Please choose your plan and billing period carefully before paying.
          If applicable law in your country gives you additional mandatory
          rights, we will comply with those legal requirements.
        </p>
      </section>

      {/* ------------------------- SECTION 4 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">4. Billing errors</h2>

        <p>
          While payments are non-refundable in normal situations, we will
          investigate:
        </p>

        <ul>
          <li>Duplicate payments for the same billing period.</li>
          <li>Obvious technical errors in charging your account.</li>
        </ul>

        <p>
          If we confirm that a payment was taken in error (for example, a
          duplicate charge), we will correct the issue. This may be through a
          refund or a credit on your account, depending on the circumstances and
          the rules of the payment provider.
        </p>

        <p>
          If you believe there has been a billing error, please contact us as
          soon as possible at <strong>sedifexbiz@gmail.com</strong> with:
        </p>

        <ul>
          <li>Your name and business name.</li>
          <li>The date and amount of the payment.</li>
          <li>
            Any Paystack reference or screenshot that can help us locate the
            transaction.
          </li>
        </ul>
      </section>

      {/* ------------------------- SECTION 5 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">5. Renewal and cancellation</h2>

        <ul>
          <li>
            Your subscription may renew automatically at the end of each billing
            period using the same payment method, unless you cancel in advance.
          </li>
          <li>
            You can request cancellation at any time by emailing{" "}
            <strong>sedifexbiz@gmail.com</strong> or using any cancellation
            option provided inside the app.
          </li>
          <li>
            Cancelling stops <strong>future</strong> renewals only; it does not
            trigger a refund for the current billing period.
          </li>
          <li>
            After cancellation, you retain access to Sedifex until the end of
            the period you have already paid for. After that, your workspace may
            lose access to paid features.
          </li>
        </ul>
      </section>

      {/* ------------------------- SECTION 6 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          6. Account closure and data deletion
        </h2>

        <p>
          If you want to completely close your account and request deletion of
          your data, you can email <strong>sedifexbiz@gmail.com</strong>.
        </p>

        <ul>
          <li>
            We will delete or anonymise personal data and store data from our
            systems, except where we are required to keep some information for
            legal, tax, accounting or security reasons.
          </li>
          <li>
            Once your data is deleted, it may not be possible to recover any of
            your previous reports or records.
          </li>
        </ul>

        <p>
          For more information about how we handle your information, please see
          our <strong>Privacy Policy</strong> at <code>/privacy</code>.
        </p>
      </section>

      {/* ------------------------- SECTION 7 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">7. Changes to this policy</h2>

        <p>
          We may update this Subscription &amp; Refund Policy from time to time.
          When we do, we will update the “Last updated” date at the top of this
          page and may provide an in-app or email notice for significant
          changes.
        </p>
      </section>

      {/* ------------------------- SECTION 8 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">8. Contact us</h2>

        <p>If you have any questions about this policy, please contact:</p>

        <ul>
          <li>
            <strong>Email:</strong> sedifexbiz@gmail.com
          </li>
          <li>
            <strong>Address:</strong> Kwamisa Street GA 5808547, Awoshie, Ghana
          </li>
          <li>
            <strong>Owner:</strong> Learn Language Education Academy
          </li>
        </ul>
      </section>
    </main>
  );
}
