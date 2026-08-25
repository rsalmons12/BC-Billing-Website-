import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HIPAA Notice — BC Billing",
  description: "HIPAA notice and acceptable-use terms for authorized users of the BC Billing Solutions application.",
};

const EFFECTIVE = "August 2026";
const CONTACT = "robertsalmons1@gmail.com";

export default function HipaaPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-[15px] leading-relaxed text-slate-800">
      <h1 className="font-display text-3xl font-bold text-slate-900">HIPAA Notice &amp; Acceptable Use</h1>
      <p className="mt-1 text-sm text-slate-500">Effective {EFFECTIVE}</p>

      <p className="mt-6">
        The <strong>BC Billing Solutions</strong> application (the &ldquo;Service&rdquo;)
        contains <strong>Protected Health Information (PHI)</strong> governed by the Health
        Insurance Portability and Accountability Act (&ldquo;HIPAA&rdquo;). Access is limited
        to authorized BC Billing workforce members and authorized treatment-facility clients.
        By signing in, you acknowledge and agree to the terms below.
      </p>

      <Section title="1. Authorized use only">
        You may access and use PHI in the Service <strong>solely</strong> to perform your
        job duties on behalf of BC Billing or your facility — billing, collections,
        authorizations, negotiations, payments, and related reporting. Accessing PHI out of
        curiosity, for personal reasons, or for anyone other than the patients you are
        authorized to work is prohibited.
      </Section>

      <Section title="2. Minimum necessary">
        Access, use, and share only the minimum information necessary to complete the task
        at hand.
      </Section>

      <Section title="3. Protect your access">
        Keep your login credentials confidential. Do not share your account, let others use
        it, or leave the Service open on an unattended or unsecured device. Do not export,
        screenshot, copy, print, email, or otherwise remove PHI from the Service except as
        required for your authorized work and permitted by BC Billing.
      </Section>

      <Section title="4. No unauthorized disclosure">
        Do not disclose PHI to any person or system that is not authorized to receive it.
        Report any suspected breach, loss, or unauthorized access immediately to BC Billing
        management.
      </Section>

      <Section title="5. Monitoring">
        Use of the Service is logged and may be monitored and audited to protect PHI and
        ensure compliance with HIPAA and BC Billing policies.
      </Section>

      <Section title="6. Consequences">
        Violations may result in loss of access, disciplinary action, and civil or criminal
        penalties under HIPAA and applicable law.
      </Section>

      <Section title="7. Questions">
        <p>
          Questions about this notice or HIPAA compliance:{" "}
          <a href={`mailto:${CONTACT}`} className="font-semibold text-blue-700 underline">
            {CONTACT}
          </a>
          . See also our{" "}
          <a href="/privacy" className="font-semibold text-blue-700 underline">
            Privacy Policy
          </a>
          .
        </p>
      </Section>

      <p className="mt-10 text-sm text-slate-500">
        By signing in to BC Billing, you confirm that you have read, understood, and agree
        to this HIPAA Notice &amp; Acceptable Use and to the Privacy Policy.
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-semibold text-slate-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
