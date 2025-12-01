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
        Refund &amp; Cancellation Policy
      </h1>

      <p className="mb-8 text-sm text-slate-500">Last updated: {today}</p>

      <p>
        This policy explains how billing, trials, renewals and refunds work for
        <strong> Sedifex</strong> subscriptions. Sedifex is owned and operated by{" "}
        <strong>Learn Language Education Academy</strong>.
      </p>

      {/* ----------------------- SECTION 1 ----------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">1. Subscription model</h2>
        <ul>
          <li>
            Sedifex is a subscription service. Workspaces are billed on a{" "}
            <strong>monthly</strong> basis by default.
          </li>
          <li>
            Some plans offer <strong>yearly</strong> billing at a discounted rate.
            Yearly plans are paid upfront for the full period.
          </li>
          <li>
            Payments are processed securely via third-party providers like Paystack.
            Subscriptions renew automatically unless cancelled.
          </li>
        </ul>
      </section>

      {/* ----------------------- SECTION 2 ----------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">2. Free trial</h2>
        <ul>
          <li>
            New workspaces receive a <strong>trial period</strong> to explore
            features and determine whether Sedifex meets their needs.
          </li>
          <li>You may cancel anytime during the trial without being charged.</li>
          <li>
            By activating a subscription (or allowing the trial to convert), you
            confirm that you have evaluated the product and wish to continue.
          </li>
        </ul>
      </section>

      {/* ----------------------- SECTION 3 ----------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">3. No-refund policy</h2>
        <p>
          Because we provide a full trial period before billing starts, all{" "}
          <strong>payments are final and non-refundable</strong>.
        </p>

        <ul>
          <li>No refunds for partial months or unused time.</li>
          <li>No refunds if you forget to cancel before renewal.</li>
          <li>No refunds for downgrades mid-cycle; changes apply next period.</li>
        </ul>

        <p className="mt-3 text-sm text-slate-500">
          In rare cases involving technical billing errors (e.g., duplicate
          charges), we will work with our payment processor to correct the issue.
          This is at our discretion and does not apply to standard renewals.
        </p>
      </section>

      {/* ----------------------- SECTION 4 ----------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">4. Cancelling your subscription</h2>
        <ul>
          <li>
            You may cancel anytime from your Sedifex workspace or by emailing{" "}
            <a href="mailto:sedifexbiz@gmail.com">sedifexbiz@gmail.com</a>.
          </li>
          <li>
            After cancellation, your subscription remains active until the end of
            the current billing period.
          </li>
          <li>
            Your workspace loses access to paid features once the billing cycle
            ends.
          </li>
        </ul>
      </section>

      {/* ----------------------- SECTION 5 ----------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">5. Data after cancellation</h2>
        <p>After your subscription ends:</p>
        <ul>
          <li>
            We may retain data briefly for reactivation or compliance purposes.
          </li>
          <li>
            You may request export of important data before cancellation (subject
            to technical limitations).
          </li>
          <li>
            We may delete data for long-inactive workspaces following our Privacy
            Policy.
          </li>
        </ul>
      </section>

      {/* ----------------------- SECTION 6 ----------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">6. Changes to this policy</h2>
        <p>
          We may update this Refund &amp; Cancellation Policy as needed. When
          updates occur, we will revise the date above and may notify you via email
          or in-app messages.
        </p>
      </section>

      {/* ----------------------- SECTION 7 ----------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">7. Contact</h2>
        <p>If you have questions or believe there has been a billing error:</p>

        <ul>
          <li>
            <strong>Email:</strong>{" "}
            <a href="mailto:sedifexbiz@gmail.com">sedifexbiz@gmail.com</a>
          </li>
          <li>
            <strong>Business name:</strong> Learn Language Education Academy
          </li>
          <li>
            <strong>Product:</strong> Sedifex
          </li>
        </ul>
      </section>
    </main>
  );
}
