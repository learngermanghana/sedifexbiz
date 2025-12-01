export default function CookiesPage() {
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

      <h1 className="mb-2 text-3xl font-bold text-slate-900">Cookie Policy</h1>

      <p className="mb-8 text-sm text-slate-500">Last updated: {today}</p>

      <p>
        This Cookie Policy explains how <strong>Sedifex</strong> ("we", "us", or
        "our") uses cookies and similar technologies on our websites and web
        applications.
      </p>

      {/* ------------------------- SECTION 1 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">1. What are cookies?</h2>
        <p>
          Cookies are small text files that a website stores on your device when
          you visit it. They help websites remember information about your visit,
          such as your login state or language preferences. Similar technologies
          include local storage, session storage and tracking pixels.
        </p>
      </section>

      {/* ------------------------- SECTION 2 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">2. Cookies we use</h2>
        <p>
          Sedifex focuses on essential and limited functional cookies. We do not
          currently use Google Analytics. Over time we may add privacy-friendly
          analytics or additional tools, and will update this page accordingly.
        </p>

        <h3>Essential cookies</h3>
        <p>These cookies are required for the site and app to function properly:</p>

        <ul>
          <li>Keeping you signed in to your Sedifex workspace.</li>
          <li>Remembering which workspace or store you are viewing.</li>
          <li>Security features such as CSRF protection and session validation.</li>
        </ul>

        <h3 className="mt-4">Functional cookies</h3>
        <p>
          These remember choices such as language or UI preferences, helping to
          provide a smoother experience.
        </p>

        <h3 className="mt-4">Analytics and performance</h3>
        <p>
          We may use privacy-respecting analytics tools to understand how Sedifex
          is used (for example, which pages are most helpful). When we do this,
          we aim to avoid collecting personal data and use aggregated insights
          where possible.
        </p>
      </section>

      {/* ------------------------- SECTION 3 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          3. Cookies and third-party services
        </h2>
        <p>
          Some third-party services we integrate with may set their own cookies
          when you use Sedifex. This includes:
        </p>

        <ul>
          <li>
            <strong>Payment processors</strong> such as Paystack when managing
            subscriptions or completing payments.
          </li>
          <li>
            <strong>Hosting & infrastructure providers</strong> that deliver
            static assets or improve performance.
          </li>
        </ul>

        <p className="mt-3">
          These providers have their own privacy and cookie policies. Where
          required, they are responsible for describing how their cookies work and
          obtaining any needed consent.
        </p>
      </section>

      {/* ------------------------- SECTION 4 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          4. Managing cookies and local storage
        </h2>

        <p>Most browsers allow you to manage cookies through settings:</p>

        <ul>
          <li>Delete cookies or local storage data.</li>
          <li>Block cookies for all websites or selected sites.</li>
          <li>Receive alerts before a cookie is stored.</li>
        </ul>

        <p className="mt-3">
          If you disable essential cookies, Sedifex may not function correctly and
          you may be unable to sign in or use critical features.
        </p>
      </section>

      {/* ------------------------- SECTION 5 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">5. Changes to this policy</h2>
        <p>
          We may update this Cookie Policy from time to time, especially when new
          features or third-party tools are introduced. Material changes will be
          communicated through the app or website.
        </p>
      </section>

      {/* ------------------------- SECTION 6 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">6. Contact us</h2>
        <p>
          If you have questions about this Cookie Policy, contact us at{" "}
          <a href="mailto:sedifexbiz@gmail.com">sedifexbiz@gmail.com</a>.
        </p>
      </section>
    </main>
  );
}
