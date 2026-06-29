import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — BC Billing",
  description: "Privacy Policy for the BC Billing Solutions revenue cycle management application.",
};

const EFFECTIVE = "June 29, 2026";
const CONTACT = "robertsalmons1@gmail.com";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-[15px] leading-relaxed text-slate-800">
      <h1 className="font-display text-3xl font-bold text-slate-900">Privacy Policy</h1>
      <p className="mt-1 text-sm text-slate-500">Effective {EFFECTIVE}</p>

      <p className="mt-6">
        This Privacy Policy explains how <strong>BC Billing Solutions</strong> (&ldquo;BC
        Billing,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) collects, uses, and protects
        information in connection with the BC Billing revenue cycle management application
        (the &ldquo;Service&rdquo;), available on the web and as a mobile application. The
        Service is a private, login-protected tool used by BC Billing staff and authorized
        treatment-facility clients to manage medical claims, collections, authorizations,
        negotiations, and payments.
      </p>

      <Section title="1. Who the Service is for">
        The Service is an internal business tool. Access requires an account that we
        provision. It is not intended for the general public, and there is no self-service
        signup. We collect information only from authorized users acting on behalf of BC
        Billing or its client facilities.
      </Section>

      <Section title="2. Information we collect">
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Account information</strong> — name, email address, role, assigned
            facilities, and authentication credentials, used to sign you in and control
            what you can see.
          </li>
          <li>
            <strong>Work and productivity data</strong> — notes, statuses, and records of
            claims worked, entered by users in the course of their job.
          </li>
          <li>
            <strong>Protected Health Information (PHI)</strong> — claim, patient, payer,
            and billing data that facilities provide to us so we can perform billing and
            collections services on their behalf.
          </li>
          <li>
            <strong>Basic technical data</strong> — standard session and security
            information needed to keep the Service secure and working.
          </li>
        </ul>
      </Section>

      <Section title="3. How we use information">
        We use the information solely to operate and improve the Service: to authenticate
        users, control access by role and facility, process and track claims, generate
        reporting for management, and secure the system. We do <strong>not</strong> sell
        personal information or PHI, and we do not use it for advertising.
      </Section>

      <Section title="4. How information is shared">
        Access is restricted by role and by facility. A facility&rsquo;s data is visible
        only to BC Billing staff and to that facility&rsquo;s own authorized users. We
        share data with service providers that host and secure the application (for
        example, our cloud database and hosting providers) under agreements that require
        them to protect it. We may disclose information if required by law.
      </Section>

      <Section title="5. HIPAA">
        BC Billing acts as a business associate to its client treatment facilities. We
        handle PHI in accordance with the Health Insurance Portability and Accountability
        Act (HIPAA) and applicable business associate agreements, and we apply
        administrative, technical, and physical safeguards to protect it.
      </Section>

      <Section title="6. Data security">
        Information is encrypted in transit, access is controlled by per-user roles and
        database-level row security, and destructive actions are limited to management.
        No system is perfectly secure, but we take reasonable measures to protect your
        information.
      </Section>

      <Section title="7. Data retention">
        We retain information for as long as needed to provide the Service and to meet
        legal, billing, and recordkeeping obligations, after which it is deleted or
        de-identified.
      </Section>

      <Section title="8. Your choices and rights">
        Because the Service is provisioned by us, access changes (creating, disabling, or
        removing accounts) and data requests are handled through your BC Billing
        administrator. Patients with questions about their health information should
        contact their treatment facility, which controls that data.
      </Section>

      <Section title="9. Children">
        The Service is a workplace tool and is not directed to children, and we do not
        knowingly collect information from children through it.
      </Section>

      <Section title="10. Changes to this policy">
        We may update this policy from time to time. Material changes will be reflected by
        updating the effective date above.
      </Section>

      <Section title="11. Contact us">
        Questions about this policy or your information? Contact us at{" "}
        <a className="text-sky-600 underline" href={`mailto:${CONTACT}`}>
          {CONTACT}
        </a>
        .
      </Section>

      <p className="mt-10 text-xs text-slate-400">
        © {new Date().getFullYear()} BC Billing Solutions. All rights reserved.
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="font-display text-lg font-bold text-slate-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
