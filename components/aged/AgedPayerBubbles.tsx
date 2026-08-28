import Link from "next/link";
import { money } from "@/lib/format";

export type AgedPayer = {
  payer: string;
  balance: number;
  lines: number;
};

// Second drill level: the 120+ day claims for ONE facility, bucketed by payer
// (Aetna, BCBS, UHC, …) with a count and balance each. Clicking a payer opens
// Collections pre-filtered to that facility + payer + 120+ bucket.
export default function AgedPayerBubbles({
  facilityId,
  facilityName,
  payers,
  minDays,
}: {
  facilityId: string;
  facilityName: string;
  payers: AgedPayer[];
  minDays: number;
}) {
  const totalLines = payers.reduce((s, p) => s + p.lines, 0);
  const totalBal = payers.reduce((s, p) => s + p.balance, 0);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-5">
        <Link href="/aged" className="text-xs font-semibold text-command hover:underline">
          ← All facilities
        </Link>
        <h1 className="mt-1 font-display text-xl font-bold">
          {facilityName} — {minDays}+ Day Claims by Payer
        </h1>
        <p className="mt-1 text-sm text-surface-muted">
          {money(totalBal)} across {totalLines.toLocaleString()} claim line
          {totalLines === 1 ? "" : "s"}. Click a payer to open and work those claims.
        </p>
      </div>

      {payers.length === 0 ? (
        <div className="card p-8 text-center text-sm text-surface-muted">
          No claims aged {minDays} days or more for this facility. 🎉
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {payers.map((p) => (
            <Link
              key={p.payer}
              href={`/collections?facility=${encodeURIComponent(facilityId)}&aged=${minDays}&payer=${encodeURIComponent(p.payer)}`}
              className="group block rounded-xl border border-[#9DC3E6] bg-[#DAEAF7] p-5 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-[#2f5578] dark:bg-[#12314d]"
            >
              <div className="font-display text-lg font-bold text-[#1b3a5b] dark:text-[#cfe4f7]">
                {p.payer}
              </div>
              <div className="mt-1 font-display text-2xl font-extrabold text-[#12314d] dark:text-white">
                {p.lines.toLocaleString()}
              </div>
              <div className="mt-1 text-sm font-semibold text-[#1b3a5b] dark:text-[#cfe4f7]">
                claim line{p.lines === 1 ? "" : "s"}
              </div>
              <div className="text-sm text-[#3d5f80] dark:text-[#9dc3e6]">{money(p.balance)}</div>
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
