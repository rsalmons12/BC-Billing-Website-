"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { SumCard } from "@/components/trackers/TrackerModule";
import { money } from "@/lib/format";
import { isExcludedMember } from "@/lib/claims";
import { FLAG_OPTIONS, AUTH_FLAG_OPTIONS } from "@/lib/constants";
import {
  RISK_AGE_THRESHOLD,
  type Claim,
  type ClaimWork,
  type ClaimRow,
  type Facility,
} from "@/lib/types";

type Bucket = "all" | "0-35" | "36+" | "risk";
type Worked = "all" | "unworked" | "worked";

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

function isWorked(w: ClaimWork | null): boolean {
  if (!w) return false;
  return Boolean(
    (w.initials && w.initials.trim()) ||
      (w.date_worked && w.date_worked.trim()) ||
      (w.notes && w.notes.trim())
  );
}

function AgeBadge({ age }: { age: number | null }) {
  const a = age ?? 0;
  let cls = "bg-recovered/12 text-recovered";
  if (a > RISK_AGE_THRESHOLD) cls = "bg-risk/12 text-risk";
  else if (a >= 36) cls = "bg-gold/15 text-gold";
  return <span className={`badge ${cls} font-mono`}>{a}d</span>;
}

export default function CollectionsClient({
  facilities,
  userId,
}: {
  facilities: Facility[];
  userId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [facilityId, setFacilityId] = useState<string>(
    facilities[0]?.id ?? ""
  );
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [bucket, setBucket] = useState<Bucket>("all");
  const [worked, setWorked] = useState<Worked>("all");
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState<string>("");
  const [groupByPatient, setGroupByPatient] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const load = useCallback(async () => {
    if (!facilityId) {
      setRows([]);
      return;
    }
    setLoading(true);
    const claimList = await selectAll<Claim>((f, t) =>
      supabase
        .from("claims")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("present", true)
        .order("age_days", { ascending: false })
        .range(f, t)
    );
    // Excluded plans (e.g. VMAH member ids) are hidden from Collections entirely.
    const visibleClaims = claimList.filter((c) => !isExcludedMember(c.member_id));
    const ids = visibleClaims.map((c) => c.claim_id);

    let workMap: Record<string, ClaimWork> = {};
    for (let i = 0; i < ids.length; i += 1000) {
      const slice = ids.slice(i, i + 1000);
      const { data: work } = await supabase
        .from("claim_work")
        .select("*")
        .in("claim_id", slice);
      for (const w of (work as ClaimWork[]) ?? []) {
        workMap[w.claim_id] = w;
      }
    }

    setRows(
      visibleClaims.map((c) => ({ ...c, work: workMap[c.claim_id] ?? null }))
    );
    setLoading(false);
  }, [facilityId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Persist a partial claim_work change (upsert by claim_id).
  const saveWork = useCallback(
    async (claimId: string, partial: Partial<ClaimWork>) => {
      setSaveState("Saving…");
      const payload = {
        claim_id: claimId,
        ...partial,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("claim_work")
        .upsert(payload, { onConflict: "claim_id" });
      setSaveState(error ? `Error: ${error.message}` : "Saved");
      if (!error) setTimeout(() => setSaveState(""), 1200);
    },
    [supabase, userId]
  );

  // Optimistic local update + persist.
  const patchRow = useCallback(
    (claimId: string, partial: Partial<ClaimWork>) => {
      setRows((prev) =>
        prev.map((r) =>
          r.claim_id === claimId
            ? { ...r, work: { ...(r.work ?? EMPTY_WORK(claimId)), ...partial } }
            : r
        )
      );
      saveWork(claimId, partial);
    },
    [saveWork]
  );

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
      // Drop it from the active board.
      setRows((prev) => prev.filter((r) => r.claim_id !== row.claim_id));
      setTimeout(() => setSaveState(""), 1500);
    },
    [patchRow, supabase]
  );

  const onAuthFlagChange = (row: ClaimRow, value: string) => {
    if (value === "Y" && row.work?.auth_issue_status !== "open") {
      if (
        confirm(
          `Route ${row.patient_name ?? row.claim_id} to the Auth team? It will leave the active board until the auth issue is completed.`
        )
      ) {
        raiseAuthIssue(row);
      }
      return;
    }
    patchRow(row.claim_id, { auth_flag: value });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      // Hide claims parked with the auth team.
      if (r.work?.auth_issue_status === "open") return false;

      const age = r.age_days ?? 0;
      if (bucket === "0-35" && age > 35) return false;
      if (bucket === "36+" && age < 36) return false;
      if (bucket === "risk" && age <= RISK_AGE_THRESHOLD) return false;

      if (worked === "worked" && !isWorked(r.work)) return false;
      if (worked === "unworked" && isWorked(r.work)) return false;

      if (q) {
        const hay = `${r.patient_name ?? ""} ${r.member_id ?? ""} ${r.claim_id} ${
          r.claim_status ?? ""
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, bucket, worked, search]);

  const totals = useMemo(() => {
    let charge = 0;
    let balance = 0;
    let risk = 0;
    for (const r of filtered) {
      charge += r.charge_amount ?? 0;
      balance += r.balance ?? 0;
      if ((r.age_days ?? 0) > RISK_AGE_THRESHOLD) risk++;
    }
    return { charge, balance, risk, count: filtered.length };
  }, [filtered]);

  // Build the rendered rows: when grouping, a patient's claims collapse into a
  // single header row (huge speed win on big facilities) that expands on click.
  // Single-claim patients render as a normal row.
  const displayItems = useMemo(() => {
    if (!groupByPatient) {
      return filtered.map((r) => ({ kind: "row" as const, r }));
    }
    const order: string[] = [];
    const map = new Map<string, ClaimRow[]>();
    for (const r of filtered) {
      const key = (r.patient_name || "—").trim();
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(r);
    }
    const items: Array<
      | { kind: "row"; r: ClaimRow }
      | { kind: "group"; key: string; rows: ClaimRow[]; charge: number; balance: number; maxAge: number }
    > = [];
    for (const key of order) {
      const grp = map.get(key)!;
      if (grp.length === 1) {
        items.push({ kind: "row", r: grp[0] });
        continue;
      }
      let charge = 0;
      let balance = 0;
      let maxAge = 0;
      for (const r of grp) {
        charge += r.charge_amount ?? 0;
        balance += r.balance ?? 0;
        maxAge = Math.max(maxAge, r.age_days ?? 0);
      }
      items.push({ kind: "group", key, rows: grp, charge, balance, maxAge });
      if (expanded.has(key)) for (const r of grp) items.push({ kind: "row", r });
    }
    return items;
  }, [filtered, groupByPatient, expanded]);

  const RENDER_CAP = 400;
  const visibleItems = displayItems.slice(0, RENDER_CAP);
  const hiddenCount = displayItems.length - visibleItems.length;

  const exportXlsx = () => {
    const facLabel =
      facilities.find((f) => f.id === facilityId)?.short_name ||
      facilities.find((f) => f.id === facilityId)?.name ||
      "facility";
    const data = filtered.map((r) => {
      const w = r.work ?? EMPTY_WORK(r.claim_id);
      return {
        Patient: r.patient_name ?? "",
        "Member ID": r.member_id ?? "",
        "Age (Days)": r.age_days ?? 0,
        "DOS From": r.dos_from ?? "",
        "DOS To": r.dos_to ?? "",
        Charge: r.charge_amount ?? 0,
        Balance: r.balance ?? 0,
        Status: r.claim_status ?? "",
        "Med Rec": w.med_rec,
        Auth: w.auth_flag,
        Billing: w.billing,
        "Cap Blue": w.cap_blue,
        Highmark: w.highmark,
        Rebill: w.rebill,
        Mgmt: w.mgmt_needed ? "Y" : "",
        Notes: w.notes,
        Initials: w.initials,
        "Date Worked": w.date_worked,
        "Claim ID": r.claim_id,
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Collections");
    XLSX.writeFile(wb, `collections-${facLabel}.xlsx`);
  };

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface-card px-6 py-3">
        <select
          value={facilityId}
          onChange={(e) => setFacilityId(e.target.value)}
          className="input max-w-[16rem]"
        >
          {facilities.length === 0 && <option value="">No facilities</option>}
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.short_name || f.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded-lg border border-surface-border p-0.5">
          {(
            [
              ["all", "All"],
              ["0-35", "0–35d"],
              ["36+", "36+d"],
              ["risk", "Risk 65+"],
            ] as [Bucket, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setBucket(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                bucket === key
                  ? "bg-command text-command-text"
                  : "text-surface-muted hover:bg-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-surface-border p-0.5">
          {(
            [
              ["all", "All"],
              ["unworked", "Unworked"],
              ["worked", "Worked"],
            ] as [Worked, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setWorked(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                worked === key
                  ? "bg-command text-command-text"
                  : "text-surface-muted hover:bg-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          placeholder="Search patient, member, claim…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-[18rem] flex-1"
        />

        <button
          onClick={() => setGroupByPatient((g) => !g)}
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
            groupByPatient
              ? "border-gold bg-gold/15 text-gold"
              : "border-surface-border text-surface-muted hover:bg-surface"
          }`}
          title="Collapse each patient's claims into one expandable row"
        >
          {groupByPatient ? "✓ Grouped by patient" : "Group by patient"}
        </button>
        {groupByPatient && (
          <button
            onClick={() => setExpanded(new Set())}
            className="rounded-lg border border-surface-border px-2 py-1.5 text-xs font-semibold text-surface-muted hover:bg-surface"
            title="Collapse all patients"
          >
            Collapse all
          </button>
        )}
        <button
          onClick={exportXlsx}
          disabled={filtered.length === 0}
          className="rounded-lg border border-surface-border px-2.5 py-1.5 text-xs font-semibold text-surface-muted hover:bg-surface disabled:opacity-50"
          title="Export the current facility's claims to Excel"
        >
          ↓ Export
        </button>

        <div className="ml-auto flex items-center gap-4 text-xs">
          {saveState && (
            <span className="font-medium text-secured">{saveState}</span>
          )}
          <span className="text-surface-muted">
            <b className="text-surface-ink">{totals.count}</b> claims
          </span>
          <span className="text-surface-muted">
            Balance{" "}
            <b className="font-mono text-surface-ink">{money(totals.balance)}</b>
          </span>
          <span className="text-surface-muted">
            Risk <b className="text-risk">{totals.risk}</b>
          </span>
        </div>
      </div>

      {/* summary cards */}
      <div className="grid grid-cols-2 gap-3 border-b border-surface-border bg-surface px-6 py-3 md:grid-cols-5">
        <SumCard label="Claims" value={String(totals.count)} />
        <SumCard label="Charged" value={money(totals.charge)} />
        <SumCard label="Balance" value={money(totals.balance)} accent="gold" />
        <SumCard
          label="Recovered"
          value={money(totals.charge - totals.balance)}
          accent="recovered"
        />
        <SumCard label="Risk 65+" value={String(totals.risk)} accent="risk" />
      </div>

      {/* table */}
      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th sticky left-0 bg-surface">Patient</th>
              <th className="th">Member ID</th>
              <th className="th">Age</th>
              <th className="th">DOS</th>
              <th className="th text-right">Charge</th>
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
              <th className="th">Date Worked</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={17} className="td py-10 text-center text-surface-muted">
                  Loading claims…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={17} className="td py-10 text-center text-surface-muted">
                  No claims match the current filters.
                </td>
              </tr>
            )}
            {!loading &&
              visibleItems.map((item, idx) => {
                if (item.kind === "group") {
                  const g = item;
                  const isOpen = expanded.has(g.key);
                  return (
                    <tr key={`g-${g.key}`} className="bg-command/[0.04]">
                      <td colSpan={17} className="td">
                        <button
                          onClick={() => toggleGroup(g.key)}
                          className="flex w-full items-center gap-3 text-left"
                        >
                          <span className="w-3 text-gold">{isOpen ? "▾" : "▸"}</span>
                          <span className="font-semibold">{g.key}</span>
                          <span className="badge bg-surface text-surface-muted">
                            {g.rows.length} claims
                          </span>
                          <AgeBadge age={g.maxAge} />
                          <span className="ml-auto font-mono text-xs text-surface-muted">
                            charge {money(g.charge)} · bal{" "}
                            <b className="text-surface-ink">{money(g.balance)}</b>
                          </span>
                        </button>
                      </td>
                    </tr>
                  );
                }
                const r = item.r;
                const i = idx;
                const w = r.work ?? EMPTY_WORK(r.claim_id);
                return (
                  <tr
                    key={r.claim_id}
                    className={`${
                      i % 2 ? "bg-surface/40" : "bg-surface-card"
                    } hover:bg-gold/5`}
                  >
                    <td className="td sticky left-0 bg-inherit font-medium">
                      {r.patient_name || "—"}
                    </td>
                    <td className="td font-mono text-xs text-surface-muted">
                      {r.member_id || "—"}
                    </td>
                    <td className="td">
                      <AgeBadge age={r.age_days} />
                    </td>
                    <td className="td text-xs text-surface-muted">
                      {r.dos_from || "—"}
                      {r.dos_to ? `–${r.dos_to}` : ""}
                    </td>
                    <td className="td text-right font-mono">
                      {money(r.charge_amount)}
                    </td>
                    <td className="td text-right font-mono font-semibold">
                      {money(r.balance)}
                    </td>
                    <td className="td">
                      <StatusCell
                        value={r.claim_status ?? ""}
                        onSave={(v) => {
                          setRows((prev) =>
                            prev.map((x) =>
                              x.claim_id === r.claim_id
                                ? { ...x, claim_status: v }
                                : x
                            )
                          );
                          supabase
                            .from("claims")
                            .update({ claim_status: v })
                            .eq("id", r.id);
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
                      <TextCell
                        value={w.date_worked}
                        className="w-28"
                        type="date"
                        onSave={(v) => patchRow(r.claim_id, { date_worked: v })}
                      />
                    </td>
                  </tr>
                );
              })}
            {!loading && hiddenCount > 0 && (
              <tr>
                <td colSpan={17} className="td py-3 text-center text-xs text-surface-muted">
                  Showing the first {RENDER_CAP} of {displayItems.length} —
                  narrow with a bucket, search, or collapse patient groups to see
                  the rest.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
        className={`cell-input w-14 ${value === "Y" ? "font-semibold text-recovered" : value === "N" ? "text-risk" : ""}`}
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

// Status cell — shows the real payer status text (e.g. "CLAIM AT HORIZON
// BLUE"), wrapped so the whole value is visible, and stays editable.
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
      className="min-w-[18rem] max-w-[28rem]"
      placeholder="Add a note…"
    />
  );
}

// A textarea that auto-grows to fit its content and wraps long text, so the
// full note/status is always visible without scrolling.
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
