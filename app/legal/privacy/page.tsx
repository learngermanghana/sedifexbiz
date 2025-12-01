// app/legal/privacy/page.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy | Sedifex',
  description:
    'Learn how Sedifex collects, uses, and protects your data as a store owner and end customer.',
}

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <div className="legal-container">
        <header className="legal-header">
          <p className="legal-kicker">Legal</p>
          <h1 className="legal-title">Privacy Policy</h1>
          <p className="legal-subtitle">
            This Privacy Policy explains how Sedifex (&quot;we&quot;, &quot;us&quot;,
            &quot;our&quot;) collects, uses, and protects information when you use our
            products and services.
          </p>
          <p className="legal-meta">
            Last updated: {new Date().getFullYear()}
          </p>
        </header>

        <section className="legal-section">
          <h2>1. Who we are</h2>
          <p>
            Sedifex is a point-of-sale and inventory management platform built and
            operated by <strong>Learn Language Education Academy</strong>.
          </p>
          <p>
            Founder: <strong>Felix Asadu</strong> (also CEO of Falowen App and Learn
            Language Education Academy)
            <br />
            Legal entity: <strong>Learn Language Education Academy</strong>
            <br />
            Contact email: <a href="mailto:sedifexbiz@gmail.com">sedifexbiz@gmail.com</a>
          </p>
        </section>

        <section className="legal-section">
          <h2>2. What this policy covers</h2>
          <p>This policy applies to:</p>
          <ul>
            <li>The Sedifex web app and dashboard used by store owners and staff</li>
            <li>Any connected tools, APIs, and integrations offered as part of Sedifex</li>
            <li>Support, onboarding, and communication related to Sedifex</li>
          </ul>
          <p>
            This policy does <strong>not</strong> cover any independent websites, apps,
            or services owned by our customers. Each store or business using Sedifex is
            responsible for its own legal obligations to its customers.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Information we collect</h2>

          <h3>3.1 Account and workspace information</h3>
          <p>When you create a Sedifex workspace or account, we may collect:</p>
          <ul>
            <li>Name and contact details (email address, phone number)</li>
            <li>Business details (store name, address, country, city)</li>
            <li>Workspace identifiers (store ID, workspace slug)</li>
            <li>Authentication details from our identity provider</li>
          </ul>

          <h3>3.2 Store and transaction data</h3>
          <p>
            To provide core POS and inventory functionality, we process data such as:
          </p>
          <ul>
            <li>Product records (name, SKU, pricing, stock levels)</li>
            <li>Sales orders, receipts, and line items</li>
            <li>Payments and settlement metadata provided by our payment processors</li>
            <li>Customer profiles created by you inside Sedifex (e.g. name, contact)</li>
          </ul>
          <p>
            This data belongs to the store or business using Sedifex. We process it only
            to operate and improve the service, and as otherwise described in this policy.
          </p>

          <h3>3.3 Payment information</h3>
          <p>
            We use <strong>Paystack</strong> and possibly other payment providers to
            process subscription payments. When you pay for Sedifex:
          </p>
          <ul>
            <li>Your card details are handled directly by Paystack or the processor</li>
            <li>
              We receive payment-related metadata such as transaction references, status,
              plan, and billing email
            </li>
          </ul>
          <p>
            We do <strong>not</strong> store full card numbers or sensitive payment
            details on our own servers.
          </p>

          <h3>3.4 Usage and device information</h3>
          <p>
            When you use Sedifex, we may automatically collect basic technical
            information, such as:
          </p>
          <ul>
            <li>Device type and browser type</li>
            <li>IP address and approximate region</li>
            <li>Pages visited, actions performed, and timestamps</li>
            <li>Error logs and diagnostic information</li>
          </ul>
          <p>
            We use this to secure the platform, troubleshoot issues, and improve the
            product.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. How we use your information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide, maintain, and improve the Sedifex platform</li>
            <li>Authenticate users and secure your workspace</li>
            <li>
              Process subscription payments and manage billing (via Paystack or other
              processors)
            </li>
            <li>
              Communicate with you about updates, security notices, and customer support
            </li>
            <li>
              Analyse anonymised or aggregated usage patterns to improve performance,
              reliability, and user experience
            </li>
            <li>Comply with legal obligations and enforce our Terms of Service</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>5. Legal bases for processing</h2>
          <p>
            We rely on different legal bases to process your personal data, depending on
            the context. These may include:
          </p>
          <ul>
            <li>
              <strong>Contract:</strong> To provide the service you sign up for and
              perform our obligations under the Terms of Service.
            </li>
            <li>
              <strong>Legitimate interests:</strong> To secure the platform, prevent
              abuse, improve features, and support our business operations in a way that
              is balanced with your rights.
            </li>
            <li>
              <strong>Consent:</strong> For specific features where we explicitly ask for
              your consent (for example, some optional communications or integrations).
            </li>
            <li>
              <strong>Legal obligations:</strong> To comply with applicable laws,
              regulations, or requests from authorities where required.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>6. How we share information</h2>
          <p>We do not sell your personal data.</p>
          <p>We may share information in the following limited situations:</p>
          <ul>
            <li>
              <strong>Service providers:</strong> With trusted vendors that help us run
              Sedifex (e.g. cloud hosting, database, email, error monitoring, payment
              processing). These providers are bound by contracts and only use the data as
              instructed by us.
            </li>
            <li>
              <strong>Legal and safety:</strong> If required by law, lawful request, or
              to protect the rights, property, or safety of our users, our customers, or
              the public.
            </li>
            <li>
              <strong>Business changes:</strong> In connection with a merger, acquisition,
              or sale of assets, where data may be transferred as part of the transaction,
              subject to appropriate safeguards.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>7. Data storage and transfers</h2>
          <p>
            Sedifex uses reputable cloud infrastructure (for example, Firebase / Google
            Cloud and similar providers) to store and process data. This means your data
            may be stored or processed in data centres located outside your home country.
          </p>
          <p>
            We take reasonable steps to ensure that any cross-border transfers comply
            with applicable data protection requirements and that your data remains
            protected.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Data retention</h2>
          <p>We retain data for as long as it is reasonably necessary to:</p>
          <ul>
            <li>Provide the Sedifex service and maintain your account</li>
            <li>Support business operations such as accounting and reporting</li>
            <li>Comply with legal, tax, and regulatory requirements</li>
            <li>Resolve disputes and enforce our agreements</li>
          </ul>
          <p>
            When your workspace is closed or data is no longer needed, we take steps to
            delete or anonymise it, subject to any legal obligations that require longer
            retention.
          </p>
        </section>

        <section className="legal-section">
          <h2>9. Your rights</h2>
          <p>
            Depending on your location and applicable laws, you may have rights over your
            personal data, including:
          </p>
          <ul>
            <li>Access to the personal data we hold about you</li>
            <li>Correction of inaccurate or incomplete data</li>
            <li>
              Deletion of your personal data where it is no longer needed or where you
              withdraw consent (subject to legal and contractual limits)
            </li>
            <li>Restriction or objection to certain types of processing</li>
            <li>
              Data portability (to receive a copy of certain information in a structured
              format)
            </li>
          </ul>
          <p>
            To exercise these rights, please contact us at{' '}
            <a href="mailto:sedifexbiz@gmail.com">sedifexbiz@gmail.com</a>. We may need
            to verify your identity before processing your request.
          </p>
        </section>

        <section className="legal-section">
          <h2>10. Security</h2>
          <p>
            We use reasonable technical and organisational measures to protect your data
            against unauthorised access, loss, or misuse. These measures may include:
          </p>
          <ul>
            <li>Encrypted connections (HTTPS) for data in transit</li>
            <li>Access controls and authentication for staff accounts</li>
            <li>Role-based permissions inside your workspace</li>
            <li>Regular monitoring and updates of our infrastructure</li>
          </ul>
          <p>
            No system can be guaranteed 100% secure. If you suspect any unauthorised
            access to your account or workspace, please contact us immediately.
          </p>
        </section>

        <section className="legal-section">
          <h2>11. Children&apos;s data</h2>
          <p>
            Sedifex is designed for businesses, not children. We do not knowingly collect
            personal data directly from children. Store owners who collect data about
            their own customers are responsible for complying with any laws that apply to
            them.
          </p>
        </section>

        <section className="legal-section">
          <h2>12. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time to reflect changes in our
            services or legal requirements. When we make material changes, we will update
            the &quot;Last updated&quot; date at the top and, where appropriate, notify
            you through the app or by email.
          </p>
        </section>

        <section className="legal-section">
          <h2>13. Contact us</h2>
          <p>
            If you have questions about this Privacy Policy or how we handle your data,
            you can reach us at:
          </p>
          <p>
            Email: <a href="mailto:sedifexbiz@gmail.com">sedifexbiz@gmail.com</a>
          </p>
          <p className="legal-disclaimer">
            This page is provided for general information and does not constitute legal
            advice. You should consult your own legal counsel to understand your
            obligations as a business using Sedifex.
          </p>
        </section>
      </div>
    </main>
  )
}
