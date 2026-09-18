import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Consent — BC Billing",
  description:
    "How BC Billing collects consent for its weekly census-summary text messages, including the printable consent form and the verbal opt-in script used with facility partners and staff.",
};

const CONTACT = "robertsalmons1@gmail.com";

export default function SmsConsentPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-[15px] leading-relaxed text-slate-800">
      <h1 className="font-display text-3xl font-bold text-slate-900">
        SMS Consent — Weekly Census Updates
      </h1>
      <p className="mt-1 text-sm text-slate-500">BC Billing Solutions</p>

      <p className="mt-6">
        BC Billing Solutions (also doing business as <strong>BC Billing</strong> and{" "}
        <strong>Recovery Desk</strong>) sends a short weekly operational text message to its own
        staff and to authorized treatment-facility partners who have opted in. Each message is a
        recap of that facility&rsquo;s weekly patient census — client count, group sessions
        delivered, missed sessions, and expected revenue — with a link to the full report in our
        secure application. These are transactional account-notification messages. No marketing,
        promotional, or third-party content is sent, and mobile numbers are never sold or shared.
      </p>

      <p className="mt-3">
        Consent is collected offline, through our existing business relationship — either verbally
        or on the printed consent form below. This page documents exactly how that consent is
        obtained.
      </p>

      <Section title="Printable consent form">
        <p className="text-sm text-slate-600">
          Facility partners and staff complete and sign the form below when they provide a mobile
          number for weekly census updates.
        </p>
        <div className="mt-4 rounded-2xl border border-slate-300 bg-white p-6 shadow-sm">
          <h3 className="font-display text-lg font-bold text-slate-900">
            BC Billing — SMS Consent Form
          </h3>
          <p className="mt-2 text-sm">
            I authorize BC Billing Solutions to send me weekly operational text messages
            summarizing my facility&rsquo;s patient census (client count and expected revenue) with
            a link to the full report in the BC Billing application.
          </p>
          <ul className="mt-3 ml-5 list-disc space-y-1 text-sm">
            <li>Message frequency is approximately one message per week per facility.</li>
            <li>Message and data rates may apply.</li>
            <li>
              I can reply <strong>STOP</strong> at any time to opt out, or <strong>HELP</strong> for
              help.
            </li>
            <li>
              BC Billing does not sell or share mobile numbers or SMS opt-in information with third
              parties. See the{" "}
              <a className="text-sky-600 underline" href="/privacy">
                Privacy Policy
              </a>{" "}
              and{" "}
              <a className="text-sky-600 underline" href="/terms">
                Terms &amp; Conditions
              </a>
              .
            </li>
          </ul>
          <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <FormLine label="Name" />
            <FormLine label="Facility" />
            <FormLine label="Mobile number" />
            <FormLine label="Date" />
          </div>
          <div className="mt-5 text-sm">
            <FormLine label="Signature" />
          </div>
        </div>
      </Section>

      <Section title="Verbal opt-in script">
        <p className="text-sm text-slate-600">
          When consent is captured over the phone or in person, staff read the following script and
          record the recipient&rsquo;s agreement:
        </p>
        <blockquote className="mt-3 rounded-2xl border-l-4 border-sky-500 bg-sky-50 p-5 text-[15px] italic text-slate-800">
          &ldquo;As part of your BC Billing partnership, we can text you a short weekly census
          summary — your client count and expected revenue — with a link to the full report in the
          app. It&rsquo;s about one message a week, and message and data rates may apply. You can
          reply STOP at any time to stop the texts, or HELP for help. Do I have your permission to
          send these text messages to your mobile number [staff reads the number back]?&rdquo;
        </blockquote>
        <p className="mt-3 text-sm text-slate-600">
          Consent is recorded only after the recipient answers &ldquo;yes.&rdquo; No numbers are
          collected through a public website, and there is no keyword auto-enrollment.
        </p>
      </Section>

      <Section title="Opting out">
        Reply <strong>STOP</strong> to any message to stop receiving texts, or <strong>HELP</strong>{" "}
        for help. You may also email us at{" "}
        <a className="text-sky-600 underline" href={`mailto:${CONTACT}`}>
          {CONTACT}
        </a>{" "}
        to be removed at any time.
      </Section>

      <p className="mt-10 text-xs text-slate-400">
        © {new Date().getFullYear()} BC Billing Solutions. All rights reserved.
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-bold text-slate-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function FormLine({ label }: { label: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 h-8 border-b border-slate-400" />
    </div>
  );
}
