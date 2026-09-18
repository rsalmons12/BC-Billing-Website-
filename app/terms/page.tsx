import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms & Conditions — BC Billing",
  description: "Terms & Conditions for the BC Billing Solutions application and SMS program.",
};

const EFFECTIVE = "September 18, 2026";
const CONTACT = "robertsalmons1@gmail.com";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-[15px] leading-relaxed text-slate-800">
      <h1 className="font-display text-3xl font-bold text-slate-900">Terms &amp; Conditions</h1>
      <p className="mt-1 text-sm text-slate-500">Effective {EFFECTIVE}</p>

      <p className="mt-6">
        These Terms &amp; Conditions govern access to and use of the{" "}
        <strong>BC Billing Solutions</strong> (&ldquo;BC Billing,&rdquo; &ldquo;we,&rdquo;
        &ldquo;us&rdquo;) revenue cycle management application (the &ldquo;Service&rdquo;) and
        our text-messaging program. The Service is a private, login-protected tool provided to
        BC Billing staff and authorized treatment-facility clients.
      </p>

      <Section title="1. Access">
        Accounts are provisioned by BC Billing. There is no public self-service signup. You may
        use the Service only as authorized, for legitimate business purposes, and in compliance
        with applicable law and any agreement between BC Billing and your organization.
      </Section>

      <Section title="2. Acceptable use">
        You agree not to misuse the Service, attempt to access data you are not authorized to
        see, or interfere with its security or operation. Access is controlled by role and
        facility; a facility&rsquo;s data is available only to BC Billing and that facility&rsquo;s
        authorized users.
      </Section>

      <Section title="3. SMS / text messaging program">
        <ul className="ml-5 list-disc space-y-1">
          <li>
            By providing your mobile number and opting in, you agree to receive operational text
            messages from BC Billing — for example, a short weekly census summary with a link to
            the full report in the Service.
          </li>
          <li>
            <strong>Message frequency</strong> varies but is typically about one message per week
            per facility.
          </li>
          <li>
            <strong>Message and data rates may apply</strong> per your mobile carrier plan.
          </li>
          <li>
            Reply <strong>STOP</strong> to opt out at any time, or <strong>HELP</strong> for help.
            After you text STOP, we will send one confirmation and then stop messaging that number.
          </li>
          <li>
            We do not sell or share mobile numbers or SMS opt-in information with third parties for
            marketing. Carriers are not liable for delayed or undelivered messages.
          </li>
        </ul>
      </Section>

      <Section title="4. Protected health information">
        BC Billing acts as a business associate to its client facilities and handles protected
        health information under HIPAA and applicable business associate agreements. Text messages
        are limited to high-level operational summaries and do not contain patient-identifying
        clinical detail.
      </Section>

      <Section title="5. No warranty; limitation of liability">
        The Service is provided &ldquo;as is.&rdquo; To the extent permitted by law, BC Billing
        disclaims implied warranties and is not liable for indirect or consequential damages
        arising from use of the Service or the messaging program.
      </Section>

      <Section title="6. Changes">
        We may update these Terms from time to time. Material changes will be reflected by updating
        the effective date above.
      </Section>

      <Section title="7. Contact us">
        Questions about these Terms? Contact us at{" "}
        <a className="text-sky-600 underline" href={`mailto:${CONTACT}`}>
          {CONTACT}
        </a>
        . See also our{" "}
        <a className="text-sky-600 underline" href="/privacy">
          Privacy Policy
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
