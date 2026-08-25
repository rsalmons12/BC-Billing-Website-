import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support — BC Billing",
  description: "Support and contact information for the BC Billing Solutions revenue cycle management application.",
};

const CONTACT = "robertsalmons1@gmail.com";
const RESPONSE = "1 business day";

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-[15px] leading-relaxed text-slate-800">
      <h1 className="font-display text-3xl font-bold text-slate-900">Support</h1>
      <p className="mt-1 text-sm text-slate-500">BC Billing Solutions — Recovery Desk</p>

      <p className="mt-6">
        <strong>BC Billing</strong> is a private, login-protected revenue cycle management
        tool used by BC Billing staff and authorized treatment-facility clients to manage
        medical claims, collections, authorizations, negotiations, payments, and reporting.
        Access requires an account that we provision — there is no public signup.
      </p>

      <Section title="Get help">
        <p>
          For any question, problem, or account request, email us and we&apos;ll respond
          within about {RESPONSE}:
        </p>
        <p className="mt-2">
          <a href={`mailto:${CONTACT}`} className="font-semibold text-blue-700 underline">
            {CONTACT}
          </a>
        </p>
      </Section>

      <Section title="Account access">
        Accounts are created and assigned by BC Billing management. If you are a facility
        client or staff member and need a login, need your access level changed, or are
        locked out, email the address above and include your name and facility.
      </Section>

      <Section title="Common questions">
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Signing in</strong> — use the email and password provided when your
            account was set up. If a new account shows as &ldquo;pending,&rdquo; management
            has not yet assigned your access; email us and we&apos;ll enable it.
          </li>
          <li>
            <strong>Forgot your password</strong> — email us and we&apos;ll send a reset.
          </li>
          <li>
            <strong>Data questions</strong> — for questions about claims, payments, or
            reporting shown in the app, contact your BC Billing account manager or the
            address above.
          </li>
        </ul>
      </Section>

      <Section title="Privacy">
        <p>
          The Service handles protected health information under HIPAA. See our{" "}
          <a href="/privacy" className="font-semibold text-blue-700 underline">
            Privacy Policy
          </a>{" "}
          for how information is collected, used, and protected.
        </p>
      </Section>

      <p className="mt-10 text-sm text-slate-500">
        BC Billing Solutions · Support · <a href={`mailto:${CONTACT}`} className="underline">{CONTACT}</a>
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
