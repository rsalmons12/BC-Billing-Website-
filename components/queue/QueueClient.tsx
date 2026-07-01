"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { money } from "@/lib/format";
import { isExcludedMember } from "@/lib/claims";
import { FLAG_OPTIONS, AUTH_FLAG_OPTIONS } from "@/lib/constants";
import {
  RISK_AGE_THRESHOLD,
  PRIORITY_AGE_THRESHOLD,
  type Claim,
  type ClaimWork,
  type ClaimRow,
  type Facility,
  type Profile,
  type Assignment,
} from "@/lib/types";

const DEFAULT_TARGET = 100;

const EMPTY_WORK = (claim_id: string): ClaimWork => ({
  claim_id,
  notes: "",
  initials: "",
  date_worked: "",
  med_rec: "",
  auth_flag: "",
  billing: "",
  cap_blue: "",
  highmark: "",
  rebill: "",
  mgmt_needed: false,
  auth_issue_status: "",
  auth_notes: "",
  resolved: false,
  resolved_at: null,
  resolved_by: null,
  updated_by: null,
  updated_at: "",
});

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
  // 100+ is the top priority tier — make it unmistakable.
  if (a >= PRIORITY_AGE_THRESHOLD) {
    return (
      <span className="badge bg-risk font-mono font-bold text-white" title="100+ priority">
        {a}d ★
      </span>
    );
  }
  let cls = "bg-recovered/12 text-recovered";
  if (a > RISK_AGE_THRESHOLD) cls = "bg-risk/12 text-risk"; // 65–99 risk band
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
  // Risk-first enforcement: collectors must clear today's 65+ before working
  // anything younger. Management can lift it.
  const [enforceRiskFirst, setEnforceRiskFirst] = useState(true);

  // Which claims to show: today's queue, or just what this collector worked today.
  const [view, setView] = useState<"queue" | "today">("queue");

  // Email-a-facility-about-this-claim modal.
  const [emailClaim, setEmailClaim] = useState<ClaimRow | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailReason, setEmailReason] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");

  // Flag-claim-for-adjustment modal.
  const [adjustClaim, setAdjustClaim] = useState<ClaimRow | null>(null);
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustMsg, setAdjustMsg] = useState("");

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

    // A 100+ specialist's queue shows ONLY the top-priority band (age >= 100).
    const specialist = (collector.queue_tier ?? "standard") === "priority_100";

    // This collector's split of each facility's claims.
    const mine = claims
      .filter((c) => {
        // Excluded plans (e.g. VMAH member ids) never enter the queue.
        if (isExcludedMember(c.member_id)) return false;
        // 100+ specialists only see the 100+ band.
        if (specialist && (c.age_days ?? 0) < PRIORITY_AGE_THRESHOLD) return false;
        const cols = collectorsByFac[c.facility_id] ?? [collectorId];
        if (cols.length <= 1) return true;
        const idx = cols.indexOf(collectorId);
        return hashInt(c.claim_id) % cols.length === idx;
      })
      .map((c) => ({ ...c, work: workMap[c.claim_id] ?? null }));

    // Priority tiers: 100+ first, then 65–99, then younger; oldest-first within.
    const tier = (age: number | null) => {
      const a = age ?? 0;
      if (a >= PRIORITY_AGE_THRESHOLD) return 2;
      if (a > RISK_AGE_THRESHOLD) return 1;
      return 0;
    };
    mine.sort((a, b) => {
      const t = tier(b.age_days) - tier(a.age_days);
      if (t !== 0) return t;
      return (b.age_days ?? 0) - (a.age_days ?? 0);
    });

    setRows(mine);
    setLoading(false);
  }, [supabase, collectorId, collector.queue_tier]);

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

  // Show today's allotment AND anything already worked today (so a collector
  // can keep editing a claim they just finished without it vanishing).
  const workedTodayRows = rows.filter((r) => (r.work?.date_worked || "") === today);
  const boardRows = [...todaySet, ...workedTodayRows];

  // Stats over today's allotment (not the whole backlog).
  const riskRemaining = todaySet.filter(
    (r) => (r.age_days ?? 0) > RISK_AGE_THRESHOLD
  ).length;
  const balanceRemaining = todaySet.reduce((s, r) => s + (r.balance ?? 0), 0);
  const backlog = unworked.length; // everything not yet worked, incl. rollover

  // While any 65+ risk claim is still open today, lock the younger ones so the
  // collector can't skip ahead.
  const riskLock = enforceRiskFirst && riskRemaining > 0;

  // Apply on-screen filters. "Worked Today" view = only what this collector
  // closed out today (so they can review their notes / what they did).
  const baseRows = view === "today" ? workedTodayRows : boardRows;
  const q = search.trim().toLowerCase();
  const shown = baseRows.filter((r) => {
    if (riskOnly && (r.age_days ?? 0) <= RISK_AGE_THRESHOLD) return false;
    if (q) {
      const hay = `${r.patient_name ?? ""} ${r.claim_id ?? ""} ${r.member_id ?? ""} ${
        r.claim_status ?? ""
      }`.toLowerCase();
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

  // ---- production log helpers (keep reporting honest) ----
  const logProduction = useCallback(
    async (claimId: string, facilityId: string | null) => {
      await supabase.from("production_log").upsert(
        {
          collector_id: collectorId,
          claim_id: claimId,
          facility_id: facilityId,
          worked_on: today,
        },
        { onConflict: "collector_id,claim_id,worked_on" }
      );
    },
    [supabase, collectorId, today]
  );
  const unlogProduction = useCallback(
    async (claimId: string) => {
      await supabase
        .from("production_log")
        .delete()
        .eq("collector_id", collectorId)
        .eq("claim_id", claimId)
        .eq("worked_on", today);
    },
    [supabase, collectorId, today]
  );

  // Persist a partial claim_work change (upsert by claim_id) + optimistic UI.
  const patchRow = useCallback(
    (claimId: string, partial: Partial<ClaimWork>) => {
      const prev = rows.find((r) => r.claim_id === claimId);
      const prevWorked = (prev?.work?.date_worked || "") === today;

      setRows((cur) =>
        cur.map((r) =>
          r.claim_id === claimId
            ? { ...r, work: { ...(r.work ?? EMPTY_WORK(claimId)), ...partial } }
            : r
        )
      );
      setSaveState("Saving…");
      supabase
        .from("claim_work")
        .upsert(
          {
            claim_id: claimId,
            ...partial,
            updated_by: self.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "claim_id" }
        )
        .then(({ error }) => {
          setSaveState(error ? `Error: ${error.message}` : "Saved");
          if (!error) setTimeout(() => setSaveState(""), 1000);
        });

      // If date_worked transitioned to/from today, sync the production credit.
      if (Object.prototype.hasOwnProperty.call(partial, "date_worked")) {
        const nowWorked = (partial.date_worked || "") === today;
        if (nowWorked && !prevWorked) logProduction(claimId, prev?.facility_id ?? null);
        if (!nowWorked && prevWorked) unlogProduction(claimId);
      }
    },
    [rows, supabase, self.id, today, logProduction, unlogProduction]
  );

  // The "✓ Worked" quick action: stamp today + the collector's initials.
  const markWorked = (r: ClaimRow) =>
    patchRow(r.claim_id, {
      date_worked: today,
      initials: collector.initials || r.work?.initials || "",
    });

  const undoWorked = (r: ClaimRow) => patchRow(r.claim_id, { date_worked: "" });

  const emailFacilityHasAddr = (r: ClaimRow) =>
    Boolean(facilities.find((f) => f.id === r.facility_id)?.email);

  const submitAdjustment = async () => {
    if (!adjustClaim) return;
    setAdjustBusy(true);
    setAdjustMsg("Saving…");
    const c = adjustClaim;
    const { error } = await supabase.from("claim_adjustments").insert({
      claim_id: c.claim_id,
      facility_id: c.facility_id,
      patient_name: c.patient_name,
      member_id: c.member_id,
      dob: c.dob,
      dos_from: c.dos_from,
      dos_to: c.dos_to,
      charge_amount: c.charge_amount,
      balance: c.balance,
      age_days: c.age_days,
      claim_status: c.claim_status,
      reason: adjustReason.trim(),
      initials: collector.initials || "",
      created_by: self.id,
    });
    setAdjustBusy(false);
    if (error) {
      setAdjustMsg(`Error: ${error.message}`);
      return;
    }
    setAdjustMsg("✓ Sent to Adjustments");
    setTimeout(() => {
      setAdjustClaim(null);
      setAdjustReason("");
      setAdjustMsg("");
    }, 1100);
  };

  const sendFacilityEmail = async () => {
    if (!emailClaim) return;
    if (!emailReason.trim()) {
      setEmailMsg("Add a reason.");
      return;
    }
    const name = emailClaim.patient_name ?? "";
    setEmailBusy(true);
    setEmailMsg("Sending…");
    const res = await fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        facility_id: emailClaim.facility_id,
        claim_id: emailClaim.claim_id,
        patient_name: name,
        subject: emailSubject.trim() || `Patient: ${name}`,
        message: `Patient: ${name}\n\nReason: ${emailReason.trim()}`,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setEmailBusy(false);
    if (!res.ok) {
      setEmailMsg(`❌ ${json.error || "Could not send."}`);
      return;
    }
    setEmailMsg("✓ Sent to facility");
    setTimeout(() => {
      setEmailClaim(null);
      setEmailReason("");
      setEmailMsg("");
    }, 1100);
  };

  // Auth flag = "Y" routes the claim to the auth team and parks it off the board.
  const raiseAuthIssue = useCallback(
    async (row: ClaimRow) => {
      patchRow(row.claim_id, { auth_flag: "Y", auth_issue_status: "open" });
      setSaveState("Routing to auth team…");
      const { error } = await supabase.from("auth_issues").insert({
        claim_id: row.claim_id,
        facility_id: row.facility_id,
        patient_name: row.patient_name,
        payer: row.member_id,
        dos_from: row.dos_from,
        dos_to: row.dos_to,
        charge_amount: row.balance ?? row.charge_amount,
        status: "Not Worked",
        from_collection: true,
      });
      if (error) {
        setSaveState(`Error: ${error.message}`);
        return;
      }
      setSaveState("Sent to Auth Issues");
      setRows((prev) =>
        prev.map((r) =>
          r.claim_id === row.claim_id
            ? { ...r, work: { ...(r.work ?? EMPTY_WORK(row.claim_id)), auth_flag: "Y", auth_issue_status: "open" } }
            : r
        )
      );
      setTimeout(() => setSaveState(""), 1500);
    },
    [patchRow, supabase]
  );

  const onAuthFlagChange = (row: ClaimRow, value: string) => {
    if (value === "Y" && row.work?.auth_issue_status !== "open") {
      if (
        confirm(
          `Route ${row.patient_name ?? row.claim_id} to the Auth team? It will leave your queue until the auth issue is completed.`
        )
      ) {
        raiseAuthIssue(row);
      }
      return;
    }
    patchRow(row.claim_id, { auth_flag: value });
  };

  // Hide claims parked with the auth team.
  const visible = shown.filter((r) => r.work?.auth_issue_status !== "open");

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

        {/* view toggle: today's queue vs. what I worked today */}
        <div className="flex items-center gap-1 rounded-lg border border-surface-border p-0.5">
          {(
            [
              ["queue", "Queue"],
              ["today", `Worked Today (${workedTodayRows.length})`],
            ] as [typeof view, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                view === key
                  ? "bg-command text-command-text"
                  : "text-surface-muted hover:bg-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name / claim / member / status…"
          className="input max-w-[16rem] flex-1"
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

        {/* risk-first enforcement (management can lift it) */}
        {isManagement && (
          <button
            onClick={() => setEnforceRiskFirst((v) => !v)}
            className={`badge px-3 py-1.5 text-xs font-semibold ${
              enforceRiskFirst ? "bg-risk/15 text-risk" : "bg-surface text-surface-muted"
            }`}
            title="Require collectors to clear 65+ risk before working younger claims"
          >
            {enforceRiskFirst ? "🔒 Risk-first ON" : "Risk-first OFF"}
          </button>
        )}

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
        <p className="mt-1.5 text-[11px] text-surface-muted">
          You only ever get <b>{target}</b> for the day. Unfinished claims wait in
          the backlog ({backlog}) and come back at the top tomorrow — the daily
          count never stacks to {target * 2}.
        </p>
      </div>

      {/* risk-first lock banner */}
      {riskLock && (
        <div className="border-b border-risk/30 bg-risk/10 px-6 py-2 text-xs font-semibold text-risk">
          🔒 Work your <b>{riskRemaining}</b> remaining 65+ risk claim
          {riskRemaining === 1 ? "" : "s"} first — younger claims unlock once
          today&apos;s risk is cleared.
        </div>
      )}

      {/* queue */}
      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th sticky left-0 bg-surface">Patient</th>
              <th className="th">Facility</th>
              <th className="th">Member ID</th>
              <th className="th">DOB</th>
              <th className="th">Age</th>
              <th className="th">DOS</th>
              <th className="th text-right">Balance</th>
              <th className="th">Status</th>
              <th className="th">Med Rec</th>
              <th className="th">Auth</th>
              <th className="th">Billing</th>
              <th className="th">Cap Blue</th>
              <th className="th">Highmark</th>
              <th className="th">Rebill</th>
              <th className="th">Mgmt</th>
              <th className="th min-w-[16rem]">Notes</th>
              <th className="th">Init</th>
              <th className="th">Done</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={18} className="td py-10 text-center text-surface-muted">
                  Building your queue…
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={18} className="td py-10 text-center text-surface-muted">
                  {view === "today" ? (
                    "Nothing worked yet today — claims you mark ✓ Worked will show here with your notes."
                  ) : rows.length === 0 ? (
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
              visible.map((r, i) => {
                const risk = (r.age_days ?? 0) > RISK_AGE_THRESHOLD;
                const done = (r.work?.date_worked || "") === today;
                const locked = riskLock && !risk && !done;
                const w = r.work ?? EMPTY_WORK(r.claim_id);
                return (
                  <tr
                    key={r.claim_id}
                    className={`${i % 2 ? "bg-surface/40" : "bg-surface-card"} ${
                      risk ? "border-l-2 border-l-risk" : ""
                    } ${done || locked ? "opacity-50" : ""} hover:bg-gold/5`}
                  >
                    <td className="td sticky left-0 bg-inherit font-medium">
                      {r.patient_name || "—"}
                    </td>
                    <td className="td text-xs text-surface-muted">{facName(r.facility_id)}</td>
                    <td className="td font-mono text-xs text-surface-muted">
                      {r.member_id || "—"}
                    </td>
                    <td className="td text-xs text-surface-muted">{r.dob || "—"}</td>
                    <td className="td">
                      <AgeBadge age={r.age_days} />
                    </td>
                    <td className="td text-xs text-surface-muted">
                      {r.dos_from || "—"}
                      {r.dos_to ? `–${r.dos_to}` : ""}
                    </td>
                    <td className="td text-right font-mono font-semibold">{money(r.balance)}</td>
                    <td className="td">
                      <StatusCell
                        value={r.claim_status ?? ""}
                        onSave={(v) => {
                          setRows((prev) =>
                            prev.map((x) =>
                              x.claim_id === r.claim_id ? { ...x, claim_status: v } : x
                            )
                          );
                          supabase.from("claims").update({ claim_status: v }).eq("id", r.id);
                        }}
                      />
                    </td>
                    <FlagCell
                      value={w.med_rec}
                      onChange={(v) => patchRow(r.claim_id, { med_rec: v })}
                    />
                    <td className="td">
                      <select
                        value={w.auth_flag}
                        onChange={(e) => onAuthFlagChange(r, e.target.value)}
                        className={`cell-input w-14 ${
                          w.auth_flag === "Y" ? "text-secured font-semibold" : ""
                        }`}
                      >
                        {AUTH_FLAG_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o || "—"}
                          </option>
                        ))}
                      </select>
                    </td>
                    <FlagCell
                      value={w.billing}
                      onChange={(v) => patchRow(r.claim_id, { billing: v })}
                    />
                    <FlagCell
                      value={w.cap_blue}
                      onChange={(v) => patchRow(r.claim_id, { cap_blue: v })}
                    />
                    <FlagCell
                      value={w.highmark}
                      onChange={(v) => patchRow(r.claim_id, { highmark: v })}
                    />
                    <FlagCell
                      value={w.rebill}
                      onChange={(v) => patchRow(r.claim_id, { rebill: v })}
                    />
                    <td className="td text-center">
                      <input
                        type="checkbox"
                        checked={w.mgmt_needed}
                        onChange={(e) =>
                          patchRow(r.claim_id, { mgmt_needed: e.target.checked })
                        }
                        className="h-4 w-4 accent-gold"
                        title="Flag for management"
                      />
                    </td>
                    <td className="td">
                      <NotesCell
                        value={w.notes}
                        onSave={(v) => patchRow(r.claim_id, { notes: v })}
                      />
                    </td>
                    <td className="td">
                      <TextCell
                        value={w.initials}
                        className="w-12 uppercase"
                        onSave={(v) => patchRow(r.claim_id, { initials: v })}
                      />
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-1.5">
                        {done ? (
                          <button
                            onClick={() => undoWorked(r)}
                            className="badge bg-recovered/15 px-2 py-1 text-[11px] font-semibold text-recovered hover:bg-risk/10 hover:text-risk"
                            title="Undo — put back in the queue"
                          >
                            ✓ done ↩
                          </button>
                        ) : locked ? (
                          <span
                            className="badge cursor-not-allowed bg-surface px-2 py-1 text-[11px] font-semibold text-surface-muted"
                            title="Clear today's 65+ risk claims first"
                          >
                            🔒 65+ first
                          </span>
                        ) : (
                          <button
                            onClick={() => markWorked(r)}
                            className="btn-primary px-2.5 py-1 text-xs"
                          >
                            ✓ Worked
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEmailClaim(r);
                            setEmailSubject(`Patient: ${r.patient_name ?? ""}`);
                            setEmailReason("");
                            setEmailMsg("");
                          }}
                          className="badge bg-brand-blue/15 px-2 py-1 text-[11px] font-semibold text-brand-blue hover:bg-brand-blue/25"
                          title="Email the facility about this claim"
                        >
                          ✉
                        </button>
                        <button
                          onClick={() => {
                            setAdjustClaim(r);
                            setAdjustReason("");
                            setAdjustMsg("");
                          }}
                          className="badge bg-gold/15 px-2 py-1 text-[11px] font-semibold text-gold hover:bg-gold/25"
                          title="Flag this claim for adjustment"
                        >
                          ✎ Adjust
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Email-the-facility modal */}
      {emailClaim && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !emailBusy && setEmailClaim(null)}
        >
          <div
            className="card w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold">Email facility</h3>
              <button
                onClick={() => setEmailClaim(null)}
                className="text-sm text-surface-muted hover:underline"
              >
                Close
              </button>
            </div>
            <div className="mt-1 text-xs text-surface-muted">
              To <b className="text-surface-ink">{facName(emailClaim.facility_id)}</b>
              {emailFacilityHasAddr(emailClaim) ? (
                <>
                  {" · "}
                  {facilities.find((f) => f.id === emailClaim.facility_id)?.email}
                </>
              ) : (
                <span className="text-risk"> · no email on file (Admin → Facilities)</span>
              )}
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <span className="label">Patient</span>
                <input
                  value={emailClaim.patient_name ?? ""}
                  readOnly
                  className="input bg-surface"
                />
              </div>
              <div>
                <span className="label">Subject</span>
                <input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="input"
                  placeholder="Subject line"
                />
              </div>
              <div>
                <span className="label">Reason</span>
                <textarea
                  value={emailReason}
                  onChange={(e) => setEmailReason(e.target.value)}
                  rows={5}
                  className="input resize-none"
                  placeholder="e.g. Please provide the 10 dates of service for this patient."
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-surface-muted">
                The email includes the patient name + your reason, with the
                Collections Department / HIPAA signature. The reply lands in
                Messages.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={sendFacilityEmail}
                  disabled={emailBusy || !emailFacilityHasAddr(emailClaim)}
                  className="btn-primary disabled:opacity-60"
                >
                  {emailBusy ? "Sending…" : "✉ Send to facility"}
                </button>
                {emailMsg && (
                  <span className="text-xs font-medium text-secured">{emailMsg}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Adjust-claim modal */}
      {adjustClaim && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !adjustBusy && setAdjustClaim(null)}
        >
          <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold">Flag for adjustment</h3>
              <button
                onClick={() => setAdjustClaim(null)}
                className="text-sm text-surface-muted hover:underline"
              >
                Close
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-surface p-3 text-xs">
              <div><span className="text-surface-muted">Patient</span><div className="font-medium">{adjustClaim.patient_name || "—"}</div></div>
              <div><span className="text-surface-muted">Claim ID</span><div className="font-mono">{adjustClaim.claim_id || "—"}</div></div>
              <div><span className="text-surface-muted">Facility</span><div>{facName(adjustClaim.facility_id)}</div></div>
              <div><span className="text-surface-muted">DOB</span><div>{adjustClaim.dob || "—"}</div></div>
              <div><span className="text-surface-muted">DOS</span><div>{adjustClaim.dos_from || "—"}{adjustClaim.dos_to ? `–${adjustClaim.dos_to}` : ""}</div></div>
              <div><span className="text-surface-muted">Balance</span><div className="font-mono">{money(adjustClaim.balance)}</div></div>
            </div>
            <div className="mt-3">
              <span className="label">Reason for adjustment</span>
              <textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                rows={4}
                className="input resize-none"
                placeholder="e.g. Wrong units billed — should be 4, billed 6."
                autoFocus
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button onClick={submitAdjustment} disabled={adjustBusy} className="btn-primary disabled:opacity-60">
                {adjustBusy ? "Saving…" : "✎ Send to Adjustments"}
              </button>
              {adjustMsg && <span className="text-xs font-medium text-secured">{adjustMsg}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
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

function FlagCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <td className="td">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`cell-input w-14 ${
          value === "Y" ? "font-semibold text-recovered" : value === "N" ? "text-risk" : ""
        }`}
      >
        {FLAG_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o || "—"}
          </option>
        ))}
      </select>
    </td>
  );
}

function TextCell({
  value,
  onSave,
  className = "",
  type = "text",
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  type?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      type={type}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      className={`cell-input ${className}`}
    />
  );
}

function StatusCell({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <AutoTextarea
      value={v}
      onChange={setV}
      onBlur={() => v !== value && onSave(v)}
      className="min-w-[12rem] max-w-[16rem] text-xs"
      placeholder="Status…"
    />
  );
}

function NotesCell({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <AutoTextarea
      value={v}
      onChange={setV}
      onBlur={() => v !== value && onSave(v)}
      className="min-w-[16rem] max-w-[28rem]"
      placeholder="Add a note…"
    />
  );
}

function AutoTextarea({
  value,
  onChange,
  onBlur,
  className = "",
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      className={`cell-input resize-none overflow-hidden whitespace-pre-wrap break-words leading-snug ${className}`}
    />
  );
}
