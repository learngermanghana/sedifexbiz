export default function PrivacyPage() {
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

      <h1 className="mb-2 text-3xl font-bold text-slate-900">Privacy Policy</h1>

      <p className="mb-8 text-sm text-slate-500">Last updated: {today}</p>

      <p className="text-sm text-slate-500">
        This Privacy Policy explains how <strong>Sedifex</strong> ("Sedifex",
        "we", "us", or "our") collects, uses and protects information in connection
        with our products and services. Sedifex is owned and operated by
        <strong> Learn Language Education Academy</strong>.
      </p>

      <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
        This document is provided for information purposes only and does not
        constitute legal advice. As your business grows or your use of Sedifex
        becomes more complex, you should consult a qualified lawyer.
      </p>

      {/* ------------------------- SECTION 1 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">1. Who this policy applies to</h2>
        <p>
          This policy covers merchants, store owners, team members and any users
          who create or access a Sedifex workspace, as well as visitors to our
          websites (including subdomains such as <code>stores.sedifex.com</code>{" "}
          and <code>blog.sedifex.com</code>).
        </p>
      </section>

      {/* ------------------------- SECTION 2 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">2. Information we collect</h2>
        <p>We collect the following types of information:</p>

        <ul>
          <li>
            <strong>Account information</strong> – name, email address, business
            name, phone number, password hash, and billing details.
          </li>
          <li>
            <strong>Business information</strong> – store profile, opening hours,
            products, sales activity and team accounts.
          </li>
          <li>
            <strong>Payment information</strong> – handled by third-party
            processors such as Paystack. We do not store full card numbers.
          </li>
          <li>
            <strong>Usage information</strong> – device, browser, pages visited,
            approximate location, and in-app actions.
          </li>
          <li>
            <strong>Support information</strong> – messages and attachments sent
            through support channels.
          </li>
        </ul>
      </section>

      {/* ------------------------- SECTION 3 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">3. How we use information</h2>
        <p>We use your information to:</p>

        <ul>
          <li>Provide, maintain and improve the Sedifex platform.</li>
          <li>Manage workspaces, accounts and permissions.</li>
          <li>Process subscription payments and send billing notices.</li>
          <li>Secure the platform and detect abuse.</li>
          <li>Send product updates and support communications.</li>
          <li>
            Produce aggregated insights that do not identify individual customers.
          </li>
        </ul>
      </section>

      {/* ------------------------- SECTION 4 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">4. Legal bases (for EEA/UK users)</h2>
        <ul>
          <li>
            <strong>Contract</strong> – to deliver the service you subscribed to.
          </li>
          <li>
            <strong>Legitimate interests</strong> – security, improvements,
            communication.
          </li>
          <li>
            <strong>Consent</strong> – optional communications or cookies.
          </li>
          <li>
            <strong>Legal obligation</strong> – compliance with tax and regulatory
            requirements.
          </li>
        </ul>
      </section>

      {/* ------------------------- SECTION 5 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">5. How we share information</h2>
        <p>We do not sell personal data. We share data only with:</p>

        <ul>
          <li>
            <strong>Service providers</strong> – hosting, payments, email,
            analytics.
          </li>
          <li>
            <strong>Team members you invite</strong> – according to permissions.
          </li>
          <li>
            <strong>Legal authorities</strong> – where required by law.</li>
          <li>
            <strong>Business transfers</strong> – during mergers or acquisitions.
          </li>
        </ul>
      </section>

      {/* ------------------------- SECTION 6 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">6. Data storage and retention</h2>
        <ul>
          <li>We store data in secure cloud infrastructure.</li>
          <li>
            Data is kept while your account is active or as required by law.
          </li>
          <li>
            Upon deletion requests, we remove or anonymise data except where legally
            required to retain it.
          </li>
        </ul>
      </section>

      {/* ------------------------- SECTION 7 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          7. Security and merchant responsibilities
        </h2>
        <p>
          We use encryption, access controls and monitoring to protect your data.
          No online service is 100% secure, but we actively work to safeguard your
          information.
        </p>
        <p className="mt-3">
          Merchants must keep passwords secure, avoid account sharing and review
          workspace permissions regularly.
        </p>
      </section>

      {/* ------------------------- SECTION 8 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">8. Your rights</h2>
        <p>You may:</p>
        <ul>
          <li>Update account info inside the app.</li>
          <li>Unsubscribe from marketing emails.</li>
          <li>
            Contact us to request correction or deletion of data you cannot manage
            yourself.
          </li>
        </ul>
      </section>

      {/* ------------------------- SECTION 9 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">9. Children’s data</h2>
        <p>
          Sedifex is for businesses and not for children under 16. If a child’s data
          is detected, please contact us for removal.
        </p>
      </section>

      {/* ------------------------- SECTION 10 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">10. Changes to this policy</h2>
        <p>
          Updates may occur due to product or legal changes. The "Last updated" date
          will always reflect the latest version.
        </p>
      </section>

      {/* ------------------------- SECTION 11 ------------------------- */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">11. Contact us</h2>

        <ul>
          <li>
            <strong>Email:</strong>{" "}
            <a href="mailto:sedifexbiz@gmail.com">sedifexbiz@gmail.com</a>
          </li>
          <li>
            <strong>Business name:</strong> Learn Language Education Academy
          </li>
          <li>
            <strong>Product:</strong> Sedifex (built by Felix Asadu)
          </li>
        </ul>
      </section>
    </main>
  );
}
