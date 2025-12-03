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

      <h1 className="mb-2 text-3xl font-bold text-slate-900">Cookies Policy</h1>

      <p className="mb-8 text-sm text-slate-500">Last updated: {today}</p>

      <p className="text-sm text-slate-500">
        This Cookies Policy explains how <strong>Sedifex</strong> (“Sedifex”,
        “we”, “us”, or “our”) uses cookies and similar technologies on our
        websites and apps, including <code>www.sedifex.com</code> and{" "}
        <code>stores.sedifex.com</code>.
      </p>

      <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
        This document is for general information only and does not constitute
        legal advice. As your business or legal requirements change, you should
        review this policy with a qualified lawyer.
      </p>

      {/* ------------------------- SECTION 1 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">1. What are cookies?</h2>

        <p>
          Cookies are small text files that are stored on your device (computer,
          phone or tablet) when you visit a website. They help the site
          recognise your device and remember information about your visit.
        </p>

        <p>
          We also use similar technologies like local storage and pixels. In
          this policy, we refer to all of these technologies together as{" "}
          <strong>“cookies”</strong>.
        </p>
      </section>

      {/* ------------------------- SECTION 2 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">2. How we use cookies</h2>

        <p>We use cookies on Sedifex to:</p>

        <ul>
          <li>
            <strong>Run the service</strong> – keep you logged into your Sedifex
            account, route you to the correct workspace, and secure your
            session.
          </li>
          <li>
            <strong>Remember your settings</strong> – for example, basic
            preferences and UI choices.
          </li>
          <li>
            <strong>Improve performance</strong> – understand how our app and
            websites are used, detect errors and improve speed and stability.
          </li>
        </ul>

        <p>
          We do not use cookies to sell your personal data or to show
          third-party banner advertising on Sedifex.
        </p>
      </section>

      {/* ------------------------- SECTION 3 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">3. Types of cookies we use</h2>

        <ul>
          <li>
            <strong>Strictly necessary cookies</strong> – required for our
            websites and apps to function. For example, authentication cookies
            that keep you signed in and help protect your account. These cannot
            be switched off in our systems.
          </li>
          <li>
            <strong>Preference cookies</strong> – help remember choices you make
            (such as certain UI or language preferences) so you do not have to
            set them every time.
          </li>
          <li>
            <strong>Analytics cookies</strong> – help us understand how visitors
            use Sedifex in general (such as which pages are visited and how long
            users stay). We use this information in aggregated form to improve
            our product.
          </li>
        </ul>

        <p>
          If we introduce additional categories (for example, marketing or
          advertising cookies), we will update this policy and, where required,
          ask for your consent.
        </p>
      </section>

      {/* ------------------------- SECTION 4 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">4. Third-party cookies</h2>

        <p>
          Some cookies may be set by third-party service providers that help us
          operate Sedifex. These may include:
        </p>

        <ul>
          <li>Cloud hosting and infrastructure providers.</li>
          <li>Analytics or error-monitoring tools.</li>
          <li>
            Payment-related tools used on our main site for subscription
            information.
          </li>
        </ul>

        <p>
          These providers are only allowed to use the information they collect
          on our behalf to provide their services to us and must protect it
          appropriately.
        </p>
      </section>

      {/* ------------------------- SECTION 5 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          5. How you can manage cookies
        </h2>

        <p>
          Most web browsers allow you to control cookies through their settings.
          Depending on your browser, you may be able to:
        </p>

        <ul>
          <li>View which cookies are stored on your device.</li>
          <li>Delete cookies or clear browsing data.</li>
          <li>Block cookies from specific websites or from all websites.</li>
        </ul>

        <p>
          If you choose to block or delete <strong>essential</strong> cookies,
          some parts of Sedifex may not work correctly, and you may not be able
          to log in or stay logged in.
        </p>
      </section>

      {/* ------------------------- SECTION 6 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          6. Changes to this Cookies Policy
        </h2>

        <p>
          We may update this Cookies Policy from time to time. When we do, we
          will update the “Last updated” date at the top of this page and may
          show an in-app or website notice if the changes are significant.
        </p>
      </section>

      {/* ------------------------- SECTION 7 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">7. Contact us</h2>

        <p>
          If you have any questions about how we use cookies, you can contact
          us:
        </p>

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
