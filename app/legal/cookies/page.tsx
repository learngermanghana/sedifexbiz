// app/legal/cookies/page.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cookie Policy | Sedifex',
  description:
    'Learn how Sedifex uses cookies and similar technologies to run the platform securely and reliably.',
}

export default function CookiesPage() {
  return (
    <main className="legal-page">
      <div className="legal-container">
        <header className="legal-header">
          <p className="legal-kicker">Legal</p>
          <h1 className="legal-title">Cookie Policy</h1>
          <p className="legal-subtitle">
            This Cookie Policy explains how Sedifex (&quot;we&quot;, &quot;us&quot;,
            &quot;our&quot;) uses cookies and similar technologies on our websites and
            apps.
          </p>
          <p className="legal-meta">
            Last updated: {new Date().getFullYear()}
          </p>
        </header>

        <section className="legal-section">
          <h2>1. What are cookies?</h2>
          <p>
            Cookies are small text files that are stored on your device when you visit a
            website. They allow the site to remember your actions and preferences over
            time, such as login status or language settings.
          </p>
          <p>
            We also use similar technologies such as local storage and session storage in
            your browser to improve performance and reliability.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. How Sedifex uses cookies</h2>
          <p>
            Sedifex uses cookies and similar technologies primarily to run the platform
            securely and reliably. For example:
          </p>
          <ul>
            <li>Keeping you signed in to your workspace</li>
            <li>Remembering basic preferences and choices</li>
            <li>Helping secure your account and prevent fraudulent activity</li>
            <li>Measuring basic usage so we can understand and improve the product</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>3. Types of cookies we use</h2>

          <h3>3.1 Strictly necessary cookies</h3>
          <p>
            These cookies are essential for the Sedifex app to function. They enable
            core features such as:
          </p>
          <ul>
            <li>Signing in and authenticating your session</li>
            <li>Accessing secure areas of your workspace</li>
            <li>Performing actions like creating or updating records</li>
          </ul>
          <p>
            You cannot disable these cookies without affecting the basic operation of the
            service.
          </p>

          <h3>3.2 Preference cookies</h3>
          <p>
            These help us remember your choices, such as language, layout preferences, or
            last used workspace, to make your experience smoother.
          </p>

          <h3>3.3 Analytics and performance</h3>
          <p>
            We may use privacy-friendly analytics tools to understand high-level usage,
            such as which screens are most used and where performance issues occur. We do
            not currently use Google Analytics or third-party advertising networks.
          </p>
          <p>
            Any analytics data is used to improve reliability and user experience, not to
            build advertising profiles.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. Third-party cookies</h2>
          <p>
            Some features of Sedifex, such as payment flows via <strong>Paystack</strong>
            , may involve third-party services that set their own cookies when you
            interact with them. These cookies are controlled by those third parties and
            are subject to their own privacy and cookie policies.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Managing cookies</h2>
          <p>
            Most web browsers allow you to control cookies through their settings,
            including blocking or deleting them. However, if you disable essential
            cookies, some parts of Sedifex may not function correctly, and you may not be
            able to sign in or use the platform as intended.
          </p>
          <p>
            You can usually find cookie controls in your browser&apos;s &quot;Settings&quot;,
            &quot;Privacy&quot;, or &quot;Security&quot; sections.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Updates to this Cookie Policy</h2>
          <p>
            We may update this Cookie Policy from time to time, for example if we add new
            features or change the technologies we use. When we do, we will update the
            &quot;Last updated&quot; date at the top of this page, and may also provide
            additional notice where appropriate.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Contact us</h2>
          <p>
            If you have any questions about how we use cookies and similar technologies,
            you can reach us at:
          </p>
          <p>
            Email: <a href="mailto:sedifexbiz@gmail.com">sedifexbiz@gmail.com</a>
          </p>
        </section>
      </div>
    </main>
  )
}
