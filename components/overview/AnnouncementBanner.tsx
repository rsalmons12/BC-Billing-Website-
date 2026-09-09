// Persistent announcement on the Network Overview. Static (always shown) — it
// tells anyone landing here that this is the new platform and, if they're not
// using it yet, to contact their administrator. The right side is a small
// stylized "snapshot" of the platform (a mini dashboard mock built with markup,
// not a screenshot) so the message reads like a product callout.
export default function AnnouncementBanner() {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-command text-command-text shadow-card">
      {/* brand glow accents */}
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-brand-blue/25 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-brand-green/15 blur-3xl"
        aria-hidden
      />

      <div className="relative z-10 grid gap-5 p-5 md:grid-cols-[1.3fr_1fr] md:items-center md:p-6">
        {/* Message */}
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-brand-blue/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-blue">
            <span className="h-2 w-2 rounded-full bg-brand-green" />
            New Platform · Now Live
          </div>
          <h2 className="font-display text-xl font-extrabold leading-tight md:text-2xl">
            Welcome to the new BC Billing platform.
          </h2>
          <p className="mt-2 max-w-xl text-sm text-command-muted">
            Track revenue, collections, outstanding AR, authorizations, and weekly census —
            live, in one place. This is now your home base for reporting.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="rounded-md bg-white/5 px-2.5 py-1 text-command-text">📈 Revenue</span>
            <span className="rounded-md bg-white/5 px-2.5 py-1 text-command-text">💵 Collections</span>
            <span className="rounded-md bg-white/5 px-2.5 py-1 text-command-text">🧾 Outstanding AR</span>
            <span className="rounded-md bg-white/5 px-2.5 py-1 text-command-text">🛡 Authorizations</span>
            <span className="rounded-md bg-white/5 px-2.5 py-1 text-command-text">🗒 Census</span>
          </div>
          <p className="mt-4 rounded-lg border border-brand-blue/30 bg-brand-blue/10 px-3 py-2 text-sm font-semibold text-command-text">
            ⚠ Not using the new platform yet? Contact your administrator to get set up.
          </p>
        </div>

        {/* Stylized platform snapshot */}
        <div className="mx-auto w-full max-w-sm">
          <div className="overflow-hidden rounded-xl border border-command-border bg-command-surface shadow-lg">
            {/* window chrome */}
            <div className="flex items-center gap-1.5 border-b border-command-border px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-risk/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-gold/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-brand-green/80" />
              <span className="ml-2 text-[10px] font-semibold text-command-muted">
                Network Overview
              </span>
            </div>
            <div className="space-y-2.5 p-3">
              {/* mini KPI tiles */}
              <div className="grid grid-cols-3 gap-2">
                <MiniKpi label="Billed" value="$482K" tint="blue" />
                <MiniKpi label="Collected" value="$391K" tint="green" />
                <MiniKpi label="AR" value="$1.2M" tint="blue" />
              </div>
              {/* mini bar chart */}
              <div className="rounded-lg border border-command-border p-2.5">
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-command-muted">
                  Collections trend
                </div>
                <div className="flex h-14 items-end gap-1.5">
                  {[38, 52, 45, 63, 58, 71, 66, 82].map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t bg-gradient-to-t from-brand-blue to-brand-green"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-1.5 text-center text-[10px] text-command-muted">
            Sample view · your live numbers appear below
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniKpi({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint: "blue" | "green";
}) {
  const dot = tint === "green" ? "bg-brand-green" : "bg-brand-blue";
  return (
    <div className="rounded-lg border border-command-border bg-command px-2 py-1.5">
      <div className="flex items-center gap-1">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-[9px] font-semibold uppercase tracking-wide text-command-muted">
          {label}
        </span>
      </div>
      <div className="mt-0.5 font-display text-sm font-bold text-command-text">{value}</div>
    </div>
  );
}
