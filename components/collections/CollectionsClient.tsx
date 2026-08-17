"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { SumCard } from "@/components/trackers/TrackerModule";
import { money } from "@/lib/format";
import { isExcludedMember, isStaleClaim } from "@/lib/claims";
import { payerBucket, matchesPayer } from "@/lib/payer";
import { FLAG_OPTIONS, AUTH_FLAG_OPTIONS } from "@/lib/constants";
import {
  WATCH_AGE_THRESHOLD,
  RISK_AGE_THRESHOLD,
  PRIORITY_AGE_THRESHOLD,
  type Claim,
  type ClaimWork,
  type ClaimRow,
  type Facility,
} from "@/lib/types";

type Bucket = "all" | "0-35" | "36+" | "risk";
type Worked = "all" | "unworked" | "worked";

// Today as MM/DD/YY — bulk notes are always stamped with the current date.
function todayStamp(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(
    2,
    "0"
  )}/${String(d.getFullYear()).slice(2)}`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Split a notes field into its dated entries. Each line is "MM/DD/YY (INIT): text".
export function parseNoteEntries(value: string): { head: string; text: string }[] {
  return String(value ?? "")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim())
    .map((line) => {
      const m = line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})\s*\(([^)]*)\):\s*([\s\S]*)$/);
      return m ? { head: `${m[1]} · ${m[2]}`, text: m[3] } : { head: "", text: line };
    });
}

// Best-guess initials from a full name (e.g. "Amanda Ruiz" -> "AR").
function deriveInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}

const EMPTY_WORK = (claim_id: string): ClaimWork => ({
  claim_id,
  notes: "",
  collab_note: "",
  claim_number: "",
  reference_number: "",
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
  assigned_to: null,
  follow_up_date: null,
  resolved: false,
  resolved_at: null,
  resolved_by: null,
  claimed_by: null,
  claimed_at: null,
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
  // Flashing age tiers: 100+ red (priority), 65–99 orange (risk), 45–64 yellow (watch).
  if (a >= PRIORITY_AGE_THRESHOLD)
    return (
      <span className="badge animate-agepulse bg-risk font-mono font-bold text-white" title="100+ days — PRIORITY">
        {a}d ★
      </span>
    );
  if (a >= RISK_AGE_THRESHOLD)
    return (
      <span className="badge animate-agepulse bg-warn font-mono font-semibold text-white" title="65–99 days — RISK">
        {a}d
      </span>
    );
  if (a >= WATCH_AGE_THRESHOLD)
    return (
      <span className="badge animate-agepulse bg-watch font-mono font-semibold text-surface-ink" title="45–64 days — WATCH">
        {a}d
      </span>
    );
  return <span className="badge bg-recovered/12 font-mono text-recovered">{a}d</span>;
}

export default function CollectionsClient({
  facilities,
  userId,
  userName = "",
}: {
  facilities: Facility[];
  userId: string;
  userName?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [facilityId, setFacilityId] = useState<string>(
    facilities[0]?.id ?? ""
  );
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [bucket, setBucket] = useState<Bucket>("all");
  const [worked, setWorked] = useState<Worked>("all");
  const [payerF, setPayerF] = useState("all");
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState<string>("");
  const [groupByPatient, setGroupByPatient] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Patient ledger drawer: the patient whose full history is open (or null).
  const [ledgerKey, setLedgerKey] = useState<string | null>(null);

  // Bulk note: attach ONE dated/initialed note to several of a patient's DOS.
  const [noteGroupKey, setNoteGroupKey] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkInit, setBulkInit] = useState(deriveInitials(userName));
  const [bulkSel, setBulkSel] = useState<Set<string>>(new Set());
  const toggleBulkSel = (cid: string) =>
    setBulkSel((prev) => {
      const next = new Set(prev);
      next.has(cid) ? next.delete(cid) : next.add(cid);
      return next;
    });

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
        .order("patient_name", { ascending: true })
        .range(f, t)
    );
    // Excluded plans (e.g. VMAH member ids) are hidden from Collections entirely.
    const visibleClaims = claimList.filter(
      (c) => !isExcludedMember(c.member_id) && !isStaleClaim(c.age_days)
    );
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

  // Open the bulk-note panel for a patient group with every DOS pre-selected.
  const openBulkNote = (key: string, claimIds: string[]) => {
    setExpanded((prev) => new Set(prev).add(key));
    setNoteGroupKey(key);
    setBulkSel(new Set(claimIds));
    setBulkText("");
    setBulkInit((cur) => cur || deriveInitials(userName));
  };

  // Attach one stamped note to every selected DOS (prepended to each note).
  const applyBulkNote = (claimIds: string[]) => {
    const init = bulkInit.trim().toUpperCase();
    if (!bulkText.trim() || !init) {
      alert("A note needs your initials and text — it can't be saved without both.");
      return;
    }
    const entry = `${todayStamp()} (${init}): ${bulkText.trim()}`;
    const d = new Date();
    const todayISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    for (const cid of claimIds) {
      const existing = rows.find((x) => x.claim_id === cid)?.work?.notes ?? "";
      patchRow(cid, {
        notes: existing.trim() ? `${entry}\n${existing}` : entry,
        initials: init,
        date_worked: todayISO, // adding a note counts the claim as worked
      });
    }
    setSaveState(`Note attached to ${claimIds.length} DOS`);
    setTimeout(() => setSaveState(""), 1800);
    setNoteGroupKey(null);
    setBulkText("");
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
        collector_notes: row.work?.notes ?? "",
        from_collection: true,
        submitted_by: userId,
        submitted_by_name: userName,
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

  // Med Rec = "Y" rolls the claim over to the Medical Records department (a new
  // medical_records row), deduped by patient + DOS. The claim stays on the board.
  const raiseMedRecord = useCallback(
    async (row: ClaimRow) => {
      patchRow(row.claim_id, { med_rec: "Y" });
      setSaveState("Sending to Medical Records…");
      const { data: existing } = await supabase
        .from("medical_records")
        .select("id")
        .eq("facility_id", row.facility_id)
        .eq("patient_name", row.patient_name ?? "")
        .eq("dos_from", row.dos_from ?? "")
        .limit(1);
      if (!existing || existing.length === 0) {
        const { error } = await supabase.from("medical_records").insert({
          facility_id: row.facility_id,
          patient_name: row.patient_name,
          dos_from: row.dos_from,
          dos_to: row.dos_to,
          charge_amount: row.balance ?? row.charge_amount,
          payer: row.claim_status,
          claim_status: row.claim_status,
          record_status: "Requested",
          notes: row.work?.notes ?? "",
          updated_by: userId,
        });
        if (error) {
          setSaveState(`Error: ${error.message}`);
          return;
        }
      }
      setSaveState("Sent to Medical Records");
      setTimeout(() => setSaveState(""), 1500);
    },
    [patchRow, supabase, userId]
  );

  const onMedRecChange = (row: ClaimRow, value: string) => {
    if (value === "Y" && row.work?.med_rec !== "Y") {
      raiseMedRecord(row);
      return;
    }
    patchRow(row.claim_id, { med_rec: value });
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

      if (!matchesPayer(r.claim_status, payerF)) return false;

      if (q) {
        const hay = `${r.patient_name ?? ""} ${r.member_id ?? ""} ${r.claim_id} ${
          r.claim_status ?? ""
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, bucket, worked, payerF, search]);

  // Payer families present in the loaded claims, for the payer dropdown.
  const payerOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => payerBucket(r.claim_status)))).sort(),
    [rows]
  );

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

  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const facLabel =
      facilities.find((f) => f.id === facilityId)?.short_name ||
      facilities.find((f) => f.id === facilityId)?.name ||
      "facility";
    const data = filtered.map((r) => {
      const w = r.work ?? EMPTY_WORK(r.claim_id);
      return {
        Patient: r.patient_name ?? "",
        "Member ID": r.member_id ?? "",
        "Claim #": w.claim_number,
        "Ref #": w.reference_number,
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

        <select
          value={payerF}
          onChange={(e) => setPayerF(e.target.value)}
          className="input max-w-[10rem]"
          title="Filter by payer"
        >
          <option value="all">All payers</option>
          {payerOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

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
              <th className="th">Claim #</th>
              <th className="th">Ref #</th>
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
                <td colSpan={19} className="td py-10 text-center text-surface-muted">
                  Loading claims…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={19} className="td py-10 text-center text-surface-muted">
                  No claims match the current filters.
                </td>
              </tr>
            )}
            {!loading &&
              visibleItems.map((item, idx) => {
                if (item.kind === "group") {
                  const g = item;
                  const isOpen = expanded.has(g.key);
                  const panelOpen = noteGroupKey === g.key;
                  return (
                    <Fragment key={`g-${g.key}`}>
                      <tr className="bg-command/[0.04]">
                        <td colSpan={19} className="td">
                          <div className="flex w-full items-center gap-3">
                            <button
                              onClick={() => toggleGroup(g.key)}
                              className="flex flex-1 items-center gap-3 text-left"
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
                            <button
                              onClick={() => setLedgerKey(g.key)}
                              className="badge whitespace-nowrap border border-command/40 bg-surface px-2.5 py-1 text-[11px] font-semibold text-command"
                              title="Open this patient's full ledger — every claim and note in one place"
                            >
                              📋 Ledger
                            </button>
                            <button
                              onClick={() =>
                                panelOpen
                                  ? setNoteGroupKey(null)
                                  : openBulkNote(g.key, g.rows.map((r) => r.claim_id))
                              }
                              className="badge whitespace-nowrap bg-command px-2.5 py-1 text-[11px] font-semibold text-command-text"
                              title="Attach one note to several dates of service"
                            >
                              📝 Note to DOS
                            </button>
                          </div>
                        </td>
                      </tr>
                      {panelOpen && (
                        <tr className="bg-command/[0.06]">
                          <td colSpan={19} className="td">
                            <div className="space-y-2 p-1">
                              <div className="text-xs font-semibold">
                                Attach one note to the selected dates of service — {g.key}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {g.rows.map((r) => {
                                  const sel = bulkSel.has(r.claim_id);
                                  return (
                                    <label
                                      key={r.claim_id}
                                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                                        sel
                                          ? "border-command bg-command/10"
                                          : "border-surface-border"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={sel}
                                        onChange={() => toggleBulkSel(r.claim_id)}
                                        className="h-3.5 w-3.5 accent-command"
                                      />
                                      <span className="font-medium">
                                        {r.dos_from || "—"}
                                        {r.dos_to ? `–${r.dos_to}` : ""}
                                      </span>
                                      <span className="font-mono text-surface-muted">
                                        {money(r.balance)}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                              <div className="flex items-center gap-3 text-[11px]">
                                <button
                                  onClick={() =>
                                    setBulkSel(new Set(g.rows.map((r) => r.claim_id)))
                                  }
                                  className="underline"
                                >
                                  Select all
                                </button>
                                <button
                                  onClick={() => setBulkSel(new Set())}
                                  className="underline"
                                >
                                  Clear
                                </button>
                                <span className="text-surface-muted">
                                  {bulkSel.size} of {g.rows.length} selected
                                </span>
                              </div>
                              <div className="flex items-start gap-2">
                                <textarea
                                  rows={2}
                                  value={bulkText}
                                  onChange={(e) => setBulkText(e.target.value)}
                                  placeholder="Write one note to attach to the selected DOS…"
                                  className="cell-input min-h-[2.5rem] flex-1 resize-y leading-snug"
                                />
                                <input
                                  value={bulkInit}
                                  onChange={(e) => setBulkInit(e.target.value)}
                                  placeholder="INIT *"
                                  title="Your initials (required)"
                                  className={`cell-input w-16 uppercase ${
                                    !bulkInit.trim() ? "ring-1 ring-risk/40" : ""
                                  }`}
                                />
                                <button
                                  onClick={() => applyBulkNote(Array.from(bulkSel))}
                                  disabled={
                                    !bulkText.trim() || !bulkInit.trim() || bulkSel.size === 0
                                  }
                                  className="btn-primary whitespace-nowrap px-3 py-1.5 text-xs disabled:opacity-50"
                                >
                                  Apply to {bulkSel.size} DOS
                                </button>
                                <button
                                  onClick={() => setNoteGroupKey(null)}
                                  className="btn-ghost whitespace-nowrap px-2 py-1.5 text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                              <p className="text-[10px] text-surface-muted">
                                Stamped with today&apos;s date ({todayStamp()}) and your
                                initials, and prepended to each selected claim&apos;s notes.
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
                      <button
                        onClick={() =>
                          setLedgerKey((r.patient_name || "—").trim())
                        }
                        className="text-left hover:text-command hover:underline"
                        title="Open this patient's full ledger — every claim and note in one place"
                      >
                        {r.patient_name || "—"}
                      </button>
                    </td>
                    <td className="td font-mono text-xs text-surface-muted">
                      {r.member_id || "—"}
                    </td>
                    <td className="td">
                      <TextCell
                        value={w.claim_number}
                        className="w-28 font-mono text-xs"
                        onSave={(v) => patchRow(r.claim_id, { claim_number: v })}
                      />
                    </td>
                    <td className="td">
                      <TextCell
                        value={w.reference_number}
                        className="w-28 font-mono text-xs"
                        onSave={(v) =>
                          patchRow(r.claim_id, { reference_number: v })
                        }
                      />
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
                      onChange={(v) => onMedRecChange(r, v)}
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
                        initials={(w.initials && w.initials.trim()) || deriveInitials(userName)}
                        claimNumber={w.claim_number}
                        onClaimNumber={(v) =>
                          patchRow(r.claim_id, { claim_number: v })
                        }
                        onAppend={(full, init) =>
                          patchRow(r.claim_id, {
                            notes: full,
                            initials: init,
                            date_worked: todayISO(),
                          })
                        }
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
                <td colSpan={19} className="td py-3 text-center text-xs text-surface-muted">
                  Showing the first {RENDER_CAP} of {displayItems.length} —
                  narrow with a bucket, search, or collapse patient groups to see
                  the rest.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {ledgerKey && (
        <PatientLedger
          patient={ledgerKey}
          claims={rows.filter(
            (r) => (r.patient_name || "—").trim() === ledgerKey
          )}
          facilityName={
            facilities.find((f) => f.id === facilityId)?.short_name ||
            facilities.find((f) => f.id === facilityId)?.name ||
            ""
          }
          defaultInit={deriveInitials(userName)}
          onClose={() => setLedgerKey(null)}
          onAddNote={(claimIds, entry, init) => {
            for (const cid of claimIds) {
              const existing =
                rows.find((x) => x.claim_id === cid)?.work?.notes ?? "";
              patchRow(cid, {
                notes: existing.trim() ? `${entry}\n${existing}` : entry,
                initials: init,
                date_worked: todayISO(),
              });
            }
          }}
        />
      )}
    </div>
  );
}

// Parse "MM/DD/YY" (optionally 4-digit year) into a sortable YYYYMMDD number so
// merged notes across a patient's claims sort newest-first regardless of claim.
function noteDateKey(head: string): number {
  const m = head.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return 0;
  const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return yr * 10000 + Number(m[1]) * 100 + Number(m[2]);
}

// Patient Ledger — every claim for one patient, plus a single merged notes
// timeline pulled from ALL of their claims so any collector sees the full
// history in one place (not just the one DOS they happen to be working).
function PatientLedger({
  patient,
  claims,
  facilityName,
  defaultInit,
  onClose,
  onAddNote,
}: {
  patient: string;
  claims: ClaimRow[];
  facilityName: string;
  defaultInit: string;
  onClose: () => void;
  onAddNote: (claimIds: string[], entry: string, init: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [init, setInit] = useState(defaultInit);
  const [sel, setSel] = useState<Set<string>>(
    new Set(claims.map((c) => c.claim_id))
  );
  const toggle = (cid: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      next.has(cid) ? next.delete(cid) : next.add(cid);
      return next;
    });

  const memberId = claims.find((c) => c.member_id)?.member_id ?? "—";
  const totalCharge = claims.reduce((s, c) => s + (c.charge_amount ?? 0), 0);
  const totalBalance = claims.reduce((s, c) => s + (c.balance ?? 0), 0);

  // Merge every note entry across all of this patient's claims into one
  // timeline, tagged with the DOS it came from, newest first.
  const timeline = useMemo(() => {
    const all: { head: string; text: string; dos: string; key: number }[] = [];
    for (const c of claims) {
      const dos = `${c.dos_from || "—"}${c.dos_to ? `–${c.dos_to}` : ""}`;
      for (const e of parseNoteEntries(c.work?.notes ?? "")) {
        all.push({ ...e, dos, key: noteDateKey(e.head) });
      }
    }
    return all.sort((a, b) => b.key - a.key);
  }, [claims]);

  const add = () => {
    const t = draft.trim();
    const i = init.trim().toUpperCase();
    if (!t) return;
    if (!i) {
      alert("Add your initials before saving the note.");
      return;
    }
    if (sel.size === 0) {
      alert("Pick at least one date of service for this note.");
      return;
    }
    const entry = `${todayStamp()} (${i}): ${t}`;
    onAddNote(Array.from(sel), entry, i);
    setDraft("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl border border-surface-border bg-surface-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-4 border-b border-surface-border px-6 py-4">
          <div>
            <div className="text-lg font-semibold">{patient}</div>
            <div className="mt-0.5 text-xs text-surface-muted">
              {facilityName ? `${facilityName} · ` : ""}Member{" "}
              <span className="font-mono">{memberId}</span> · {claims.length}{" "}
              claim{claims.length === 1 ? "" : "s"} · charge{" "}
              {money(totalCharge)} · balance{" "}
              <b className="text-surface-ink">{money(totalBalance)}</b>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost px-2 py-1 text-sm"
            aria-label="Close ledger"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-4">
          {/* claims */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-muted">
              Claims
            </div>
            <div className="overflow-x-auto rounded-lg border border-surface-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface text-surface-muted">
                    <th className="px-2 py-1.5 text-left font-semibold">DOS</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Status</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Claim #</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Age</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Charge</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c) => (
                    <tr
                      key={c.claim_id}
                      className="border-t border-surface-border"
                    >
                      <td className="px-2 py-1.5 font-medium">
                        {c.dos_from || "—"}
                        {c.dos_to ? `–${c.dos_to}` : ""}
                      </td>
                      <td className="px-2 py-1.5 text-surface-muted">
                        {c.claim_status || "—"}
                      </td>
                      <td className="px-2 py-1.5 font-mono">
                        {c.work?.claim_number || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {c.age_days ?? 0}d
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {money(c.charge_amount)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold">
                        {money(c.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* merged notes timeline */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-muted">
              Notes — all collectors, all dates
            </div>
            {timeline.length === 0 ? (
              <div className="rounded-lg border border-dashed border-surface-border px-3 py-4 text-center text-xs text-surface-muted">
                No notes yet on any of this patient&apos;s claims.
              </div>
            ) : (
              <div className="space-y-1.5">
                {timeline.map((e, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-surface-border bg-surface px-2.5 py-1.5 text-xs leading-snug"
                  >
                    <div className="mb-0.5 flex flex-wrap items-center gap-2 text-surface-muted">
                      {e.head && <span className="font-semibold">{e.head}</span>}
                      <span className="badge bg-surface-card text-[10px]">
                        DOS {e.dos}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap break-words">
                      {e.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* add a patient note */}
          <div className="rounded-lg border border-command/30 bg-command/[0.04] p-3">
            <div className="mb-2 text-xs font-semibold">
              Add a note (visible to every collector on this patient)
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {claims.map((c) => {
                const on = sel.has(c.claim_id);
                return (
                  <label
                    key={c.claim_id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                      on
                        ? "border-command bg-command/10"
                        : "border-surface-border"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(c.claim_id)}
                      className="h-3 w-3 accent-command"
                    />
                    <span className="font-medium">
                      {c.dos_from || "—"}
                      {c.dos_to ? `–${c.dos_to}` : ""}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-start gap-2">
              <textarea
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a note for this patient…"
                className="cell-input min-h-[2.5rem] flex-1 resize-y leading-snug"
              />
              <input
                value={init}
                onChange={(e) => setInit(e.target.value)}
                placeholder="INIT *"
                title="Your initials (required)"
                className={`cell-input w-16 uppercase ${
                  !init.trim() ? "ring-1 ring-risk/40" : ""
                }`}
              />
              <button
                onClick={add}
                disabled={!draft.trim() || !init.trim() || sel.size === 0}
                className="btn-primary whitespace-nowrap px-3 py-1.5 text-xs disabled:opacity-50"
              >
                Add to {sel.size}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-surface-muted">
              Stamped {todayStamp()} with your initials and added to the selected
              dates of service. Every collector sees it here and on the claim.
            </p>
          </div>
        </div>
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

// Notes as an add-only, date-separated timeline: each existing entry is its own
// read-only bordered box (newest on top); a box at the bottom adds a new stamped
// entry. onAppend receives the full new notes string plus the initials used.
function NotesCell({
  value,
  initials,
  claimNumber,
  onClaimNumber,
  onAppend,
}: {
  value: string;
  initials: string;
  claimNumber: string;
  onClaimNumber: (v: string) => void;
  onAppend: (full: string, init: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const entries = parseNoteEntries(value);
  const add = () => {
    const t = draft.trim();
    const init = (initials || "").trim().toUpperCase();
    if (!t) return;
    if (!init) {
      alert("Add your initials on this row first, then add the note.");
      return;
    }
    // Prompt (but don't block) for the claim number when it's still empty, so
    // the payer claim number gets its own field instead of living in notes.
    if (!claimNumber.trim()) {
      const entered = window.prompt(
        "Claim # for this account? (Enter it here or leave blank to skip.)",
        ""
      );
      if (entered && entered.trim()) onClaimNumber(entered.trim());
    }
    const entry = `${todayStamp()} (${init}): ${t}`;
    onAppend(value.trim() ? `${entry}\n${value}` : entry, init);
    setDraft("");
  };
  return (
    <div className="min-w-[18rem] max-w-[28rem] space-y-1.5">
      {entries.map((e, i) => (
        <div
          key={i}
          className="rounded-md border border-surface-border bg-surface px-2 py-1 text-xs leading-snug"
        >
          {e.head && <div className="mb-0.5 font-semibold text-surface-muted">{e.head}</div>}
          <div className="whitespace-pre-wrap break-words">{e.text}</div>
        </div>
      ))}
      <div className="flex items-start gap-1">
        <textarea
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a note…"
          className="cell-input flex-1 resize-none overflow-hidden whitespace-pre-wrap break-words leading-snug"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="shrink-0 rounded-md border border-surface-border px-2 py-1 text-xs font-semibold text-surface-muted hover:bg-surface disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
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
