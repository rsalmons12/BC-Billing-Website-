import Link from "next/link";
import { money } from "@/lib/format";

export type AgedFacility = {
  facilityId: string;
  name: string;
  balance: number;
  lines: number;
};

// Landing page of "bubble" boxes — one per facility that has claims aged 120+
// days. Each box shows the facility, the outstanding balance on those aged
// claims, and the claim-line count. Clicking a box opens Collections pre-filtered
// to that facility's 120+ bucket so the collector can start working them.
export default function AgedBubbles({
  items,
  minDays,
}: {
  items: AgedFacility[];
  minDays: number;
}) {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-5">
        <h1 className="font-display text-xl font-bold">{minDays}+ Day Claims</h1>
        <p className="mt-1 text-sm text-surface-muted">
          Every facility with claims sitting {minDays} days or longer. Click a box to open those
          claims and start working them.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center text-sm text-surface-muted">
          No claims aged {minDays} days or more. 🎉
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((f) => (
            <Link
              key={f.facilityId}
              href={`/collections?facility=${encodeURIComponent(f.facilityId)}&aged=${minDays}`}
              className="group block rounded-xl border border-[#9DC3E6] bg-[#DAEAF7] p-5 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-[#2f5578] dark:bg-[#12314d]"
            >
              <div className="font-display text-lg font-bold text-[#1b3a5b] dark:text-[#cfe4f7]">
                {f.name}
              </div>
              <div className="mt-1 font-display text-2xl font-extrabold text-[#12314d] dark:text-white">
                {money(f.balance)}
              </div>
              <div className="mt-1 text-sm font-semibold text-[#1b3a5b] dark:text-[#cfe4f7]">
                {minDays}+ Claims
              </div>
              <div className="text-sm text-[#3d5f80] dark:text-[#9dc3e6]">
                {f.lines.toLocaleString()} Claim Line{f.lines === 1 ? "" : "s"}
              </div>
              <div className="mt-3 text-xs font-semibold text-command opacity-0 transition group-hover:opacity-100">
                Open &amp; work these →
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
