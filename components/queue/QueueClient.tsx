"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { money } from "@/lib/format";
import {
  RISK_AGE_THRESHOLD,
  type Claim,
  type ClaimWork,
  type ClaimRow,
  type Facility,
  type Profile,
  type Assignment,
} from "@/lib/types";

const DEFAULT_TARGET = 100;

// Stable hash so the same claim always lands with the same collector.
function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function AgeBadge({ age }: { age: number | null }) {
  const a = age ?? 0;
  let cls = "bg-recovered/12 text-recovered";
  if (a > RISK_AGE_THRESHOLD) cls = "bg-risk/12 text-risk";
  else if (a >= 36) cls = "bg-gold/15 text-gold";
  return <span className={`badge ${cls} font-mono`}>{a}d</span>;
}

export default function QueueClient({
  facilities,
  self,
  collectors,
  isManagement,
}: {
  facilities: Facility[];
  self: Profile;
  collectors: Profile[];
  isManagement: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [collectorId, setCollectorId] = useState(self.id);
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [riskOnly, setRiskOnly] = useState(false);

  // Customizable daily target (per collector, stored on profiles.daily_target).
  const [target, setTarget] = useState<number>(self.daily_target ?? DEFAULT_TARGET);
  // Extra claims pulled mid-day after the target is met (not persisted —
  // resets next load; 65+ stay on top because the backlog is already sorted).
  const [bonus, setBonus] = useState(0);

  const today = todayStr();

  const collector = useMemo(
    () =>
      isManagement
        ? collectors.find((c) => c.id === collectorId) ?? self
        : self,
    [isManagement, collectors, collectorId, self]
  );

  // Keep the target editor in sync with whichever collector is selected.
  useEffect(() => {
    setTarget(collector.daily_target ?? DEFAULT_TARGET);
    setBonus(0);
  }, [collector]);

  const facName = useCallback(
    (id: string | null) =>
      facilities.find((f) => f.id === id)?.short_name ||
      facilities.find((f) => f.id === id)?.name ||
      "—",
    [facilities]
  );

  const load = useCallback(async () => {
    setLoading(true);

    // All assignments we can see (RLS: management sees all; staff see their
    // own + co-collectors on their facilities once the asg_read policy allows).
    const asg = await selectAll<Assignment>((f, t) =>
      supabase.from("assignments").select("*").range(f, t)
    );

    const myFacilities = Array.from(
      new Set(asg.filter((a) => a.profile_id === collectorId).map((a) => a.facility_id))
    );
    if (myFacilities.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    // Collectors per facility (for splitting), stable order by id.
    const collectorsByFac: Record<string, string[]> = {};
    for (const fid of myFacilities) {
      collectorsByFac[fid] = Array.from(
        new Set(asg.filter((a) => a.facility_id === fid).map((a) => a.profile_id))
      ).sort();
    }

    // Claims for those facilities.
    const claims: Claim[] = [];
    for (const fid of myFacilities) {
      const c = await selectAll<Claim>((f, t) =>
        supabase
          .from("claims")
          .select("*")
          .eq("facility_id", fid)
          .eq("present", true)
          .range(f, t)
      );
      claims.push(...c);
    }

    const ids = claims.map((c) => c.claim_id);
    const workMap: Record<string, ClaimWork> = {};
    for (let i = 0; i < ids.length; i += 1000) {
      const { data } = await supabase
        .from("claim_work")
        .select("*")
        .in("claim_id", ids.slice(i, i + 1000));
      for (const w of (data as ClaimWork[]) ?? []) workMap[w.claim_id] = w;
    }

    // This collector's split of each facility's claims.
    const mine = claims
      .filter((c) => {
        const cols = collectorsByFac[c.facility_id] ?? [collectorId];
        if (cols.length <= 1) return true;
        const idx = cols.indexOf(collectorId);
        return hashInt(c.claim_id) % cols.length === idx;
      })
      .map((c) => ({ ...c, work: workMap[c.claim_id] ?? null }));

    // Risk (65+) first, then oldest first.
    mine.sort((a, b) => {
      const ar = (a.age_days ?? 0) > RISK_AGE_THRESHOLD ? 1 : 0;
      const br = (b.age_days ?? 0) > RISK_AGE_THRESHOLD ? 1 : 0;
      if (ar !== br) return br - ar;
      return (b.age_days ?? 0) - (a.age_days ?? 0);
    });

    setRows(mine);
    setLoading(false);
  }, [supabase, collectorId]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Daily pacing with rollover ---------------------------------------
  // Worked-today claims count against the day's target. Whatever is left of
  // the target is filled from the never-worked backlog (already risk-first,
  // oldest-first). Anything past the allotment simply rolls to tomorrow,
  // when "done today" resets and the next slice surfaces.
  const doneToday = rows.filter((r) => (r.work?.date_worked || "") === today).length;
  const unworked = rows.filter((r) => !r.work?.date_worked);
  const allotment = Math.max(0, target + bonus - doneToday);
  const todaySet = unworked.slice(0, allotment);

  // Stats over today's allotment (not the whole backlog).
  const riskRemaining = todaySet.filter(
    (r) => (r.age_days ?? 0) > RISK_AGE_THRESHOLD
  ).length;
  const balanceRemaining = todaySet.reduce((s, r) => s + (r.balance ?? 0), 0);
  const backlog = unworked.length; // everything not yet worked, incl. rollover

  // Apply on-screen filters to today's allotment.
  const q = search.trim().toLowerCase();
  const shown = todaySet.filter((r) => {
    if (riskOnly && (r.age_days ?? 0) <= RISK_AGE_THRESHOLD) return false;
    if (q) {
      const hay = `${r.patient_name ?? ""} ${r.claim_id ?? ""} ${r.member_id ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const saveTarget = async (next: number) => {
    const val = Math.max(1, Math.min(1000, Math.round(next || DEFAULT_TARGET)));
    setTarget(val);
    setSaveState("Saving target…");
    const { error } = await supabase
      .from("profiles")
      .update({ daily_target: val })
      .eq("id", collector.id);
    setSaveState(error ? `Error: ${error.message}` : "Target saved");
    if (!error) setTimeout(() => setSaveState(""), 900);
  };

  const markWorked = async (r: ClaimRow) => {
    setSaveState("Saving…");
    setRows((prev) =>
      prev.map((x) =>
        x.claim_id === r.claim_id
          ? {
              ...x,
              work: {
                ...(x.work ?? ({} as ClaimWork)),
                claim_id: x.claim_id,
                date_worked: today,
                initials: collector.initials || x.work?.initials || "",
              } as ClaimWork,
            }
          : x
      )
    );
    const { error } = await supabase.from("claim_work").upsert(
      {
        claim_id: r.claim_id,
        date_worked: today,
        initials: collector.initials || "",
        updated_by: self.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "claim_id" }
    );
    setSaveState(error ? `Error: ${error.message}` : "Marked worked");
    if (!error) setTimeout(() => setSaveState(""), 900);
  };

  const undoWorked = async (r: ClaimRow) => {
    setRows((prev) =>
      prev.map((x) =>
        x.claim_id === r.claim_id
          ? { ...x, work: { ...(x.work ?? ({} as ClaimWork)), claim_id: x.claim_id, date_worked: "" } as ClaimWork }
          : x
      )
    );
    await supabase.from("claim_work").upsert(
      { claim_id: r.claim_id, date_worked: null, updated_by: self.id, updated_at: new Date().toISOString() },
      { onConflict: "claim_id" }
    );
  };

  const saveNote = async (claimId: string, notes: string) => {
    setRows((prev) =>
      prev.map((x) =>
        x.claim_id === claimId
          ? { ...x, work: { ...(x.work ?? ({} as ClaimWork)), claim_id: claimId, notes } as ClaimWork }
          : x
      )
    );
    await supabase.from("claim_work").upsert(
      { claim_id: claimId, notes, updated_by: self.id, updated_at: new Date().toISOString() },
      { onConflict: "claim_id" }
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface-card px-6 py-3">
        {isManagement ? (
          <select
            value={collectorId}
            onChange={(e) => setCollectorId(e.target.value)}
            className="input max-w-[16rem]"
          >
            <option value={self.id}>— pick a collector —</option>
            {collectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name || c.id.slice(0, 8)}
              </option>
            ))}
          </select>
        ) : (
          <div className="font-semibold">
            {collector.full_name || "Your"} queue
          </div>
        )}

        {/* search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name / claim ID…"
          className="input max-w-[14rem]"
        />

        {/* 65+ only toggle */}
        <button
          onClick={() => setRiskOnly((v) => !v)}
          className={`badge px-3 py-1.5 text-xs font-semibold ${
            riskOnly ? "bg-risk/15 text-risk" : "bg-surface text-surface-muted"
          }`}
        >
          65+ only
        </button>

        {/* daily target editor */}
        <label className="flex items-center gap-1.5 text-xs font-semibold text-surface-muted">
          Daily target
          <input
            type="number"
            min={1}
            max={1000}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            onBlur={(e) => saveTarget(Number(e.target.value))}
            className="input w-20 text-center"
          />
        </label>

        {saveState && (
          <span className="ml-auto text-xs font-medium text-secured">{saveState}</span>
        )}
      </div>

      {/* progress cards */}
      <div className="grid grid-cols-2 gap-3 border-b border-surface-border bg-surface px-6 py-3 md:grid-cols-6">
        <Card label="Daily Target" value={bonus ? `${target}+${bonus}` : String(target)} />
        <Card label="Done Today" value={String(doneToday)} accent="recovered" />
        <Card label="Today Left" value={String(todaySet.length)} accent="gold" />
        <Card label="Risk 65+ Today" value={String(riskRemaining)} accent="risk" />
        <Card label="Backlog (rollover)" value={String(backlog)} />
        <Card label="Balance Today" value={money(balanceRemaining)} />
      </div>

      {/* progress bar to target */}
      <div className="border-b border-surface-border bg-surface px-6 pb-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-border">
          <div
            className="h-full rounded-full bg-recovered"
            style={{ width: `${Math.min((doneToday / Math.max(target, 1)) * 100, 100)}%` }}
          />
        </div>
      </div>

      {/* queue */}
      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th">#</th>
              <th className="th">Patient</th>
              <th className="th">Facility</th>
              <th className="th">Age</th>
              <th className="th">DOS</th>
              <th className="th text-right">Balance</th>
              <th className="th">Status</th>
              <th className="th min-w-[16rem]">Notes</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="td py-10 text-center text-surface-muted">
                  Building your queue…
                </td>
              </tr>
            )}
            {!loading && shown.length === 0 && (
              <tr>
                <td colSpan={9} className="td py-10 text-center text-surface-muted">
                  {rows.length === 0 ? (
                    "No claims assigned. Ask management to assign you facilities."
                  ) : backlog === 0 ? (
                    "🎉 Backlog clear — nice work."
                  ) : todaySet.length === 0 ? (
                    <div className="flex flex-col items-center gap-3">
                      <div>
                        🎉 Daily target met ({doneToday}/{target + bonus}). {backlog}{" "}
                        still open — roll to tomorrow or grab more now.
                      </div>
                      <button
                        onClick={() => setBonus((b) => b + 25)}
                        className="btn-primary px-4 py-1.5 text-xs"
                      >
                        ➕ Take 25 more (65+ first)
                      </button>
                    </div>
                  ) : (
                    "No claims match your filters."
                  )}
                </td>
              </tr>
            )}
            {!loading &&
              shown.map((r, i) => {
                const risk = (r.age_days ?? 0) > RISK_AGE_THRESHOLD;
                return (
                  <tr
                    key={r.claim_id}
                    className={`${i % 2 ? "bg-surface/40" : "bg-surface-card"} ${
                      risk ? "border-l-2 border-l-risk" : ""
                    }`}
                  >
                    <td className="td text-xs text-surface-muted">{i + 1}</td>
                    <td className="td font-medium">{r.patient_name || "—"}</td>
                    <td className="td text-xs text-surface-muted">{facName(r.facility_id)}</td>
                    <td className="td">
                      <AgeBadge age={r.age_days} />
                    </td>
                    <td className="td text-xs text-surface-muted">{r.dos_from || "—"}</td>
                    <td className="td text-right font-mono font-semibold">{money(r.balance)}</td>
                    <td className="td text-xs">{r.claim_status || "—"}</td>
                    <td className="td">
                      <NoteCell
                        value={r.work?.notes ?? ""}
                        onSave={(v) => saveNote(r.claim_id, v)}
                      />
                    </td>
                    <td className="td">
                      <button
                        onClick={() => markWorked(r)}
                        className="btn-primary px-2.5 py-1 text-xs"
                      >
                        ✓ Worked
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* worked-today strip (so they can undo a mistake) */}
      {!loading && doneToday > 0 && (
        <div className="border-t border-surface-border bg-surface px-6 py-2 text-xs text-surface-muted">
          {doneToday} worked today.{" "}
          <WorkedTodayUndo
            rows={rows.filter((r) => (r.work?.date_worked || "") === today)}
            onUndo={undoWorked}
          />
        </div>
      )}
    </div>
  );
}

function WorkedTodayUndo({
  rows,
  onUndo,
}: {
  rows: ClaimRow[];
  onUndo: (r: ClaimRow) => void;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-semibold text-brand-blue underline"
      >
        {open ? "Hide" : "Review / undo"}
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          {rows.map((r) => (
            <button
              key={r.claim_id}
              onClick={() => onUndo(r)}
              className="badge bg-surface-card px-2 py-1 text-[11px] hover:bg-risk/10 hover:text-risk"
              title="Undo — put back in queue"
            >
              ↩ {r.patient_name || r.claim_id}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Card({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "recovered" | "gold" | "risk";
}) {
  const color =
    accent === "recovered"
      ? "text-recovered"
      : accent === "gold"
        ? "text-gold"
        : accent === "risk"
          ? "text-risk"
          : "text-surface-ink";
  return (
    <div className="card p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
        {label}
      </div>
      <div className={`font-display text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function NoteCell({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      placeholder="Add a note…"
      className="cell-input min-w-[16rem]"
    />
  );
}
