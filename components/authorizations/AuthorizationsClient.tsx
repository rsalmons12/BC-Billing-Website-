"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import {
  ImportPanel,
  SumCard,
  type TrackerConfig,
} from "@/components/trackers/TrackerModule";
import { parseAuthorizations } from "@/lib/import/parseTrackers";
import {
  AUTH_STATUS_OPTIONS,
  LEVEL_OF_CARE_OPTIONS,
  type Facility,
  type Authorization,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

function parseDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (isNaN(t)) return null;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Inclusive day count between two date strings (10 days for 4/1–4/10).
function inclusiveDays(start: unknown, end: unknown): number | null {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b || b < a) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

// Days approved on an auth: the stored total, else derived from start/end.
function authDays(a: Authorization): number | null {
  if (a.total_days != null && !isNaN(a.total_days)) return a.total_days;
  return inclusiveDays(a.start_date, a.end_date);
}

// A claim is up for its Next Review once today lands on the review date/after.
function isDueForReview(a: Authorization): boolean {
  const d = parseDate(a.next_review_date);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() <= today.getTime();
}

// Recency of an auth — the latest meaningful date on it (falls back to created).
function authRecency(a: Authorization): number {
  const cands = [a.next_review_date, a.end_date, a.start_date, a.admit_date]
    .map(parseDate)
    .filter(Boolean) as Date[];
  const created = Date.parse(a.created_at || "");
  return Math.max(
    ...cands.map((d) => d.getTime()),
    isNaN(created) ? 0 : created
  );
}

interface PatientGroup {
  key: string;
  facility_id: string | null;
  name: string;
  auths: Authorization[]; // newest first
  current: Authorization;
}

// Minimal config so we can reuse the shared ImportPanel (replace-per-facility).
const importConfig: TrackerConfig = {
  table: "authorizations",
  searchKeys: [],
  columns: [],
  parse: (buf) => parseAuthorizations(buf),
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function AuthorizationsClient({
  facilities,
  userId,
  isManagement,
  readOnly = false,
}: {
  facilities: Facility[];
  userId: string;
  isManagement: boolean;
  readOnly?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Authorization[]>([]);
  const [loading, setLoading] = useState(true);
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | "due">("all");
  const [view, setView] = useState<"active" | "discharged">("active");
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const facName = useCallback(
    (id: string | null) => {
      const f = facilities.find((x) => x.id === id);
      return f?.short_name || f?.name || "—";
    },
    [facilities]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const data = await selectAll<Authorization>((f, t) => {
      let q = supabase
        .from("authorizations")
        .select("*")
        .order("created_at", { ascending: false });
      if (facilityFilter !== "all") q = q.eq("facility_id", facilityFilter);
      return q.range(f, t);
    });
    setRows(data);
    setLoading(false);
  }, [supabase, facilityFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Update one auth field (optimistic).
  const saveField = useCallback(
    async (id: string, key: keyof Authorization, value: unknown) => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [key]: value } : r))
      );
      setSaveState("Saving…");
      const { error } = await supabase
        .from("authorizations")
        .update({ [key]: value, updated_by: userId, updated_at: new Date().toISOString() })
        .eq("id", id);
      setSaveState(error ? `Error: ${error.message}` : "Saved");
      if (!error) setTimeout(() => setSaveState(""), 900);
    },
    [supabase, userId]
  );

  const del = useCallback(
    async (id: string) => {
      if (!confirm("Delete this authorization? This cannot be undone.")) return;
      setRows((prev) => prev.filter((r) => r.id !== id));
      const { error } = await supabase.from("authorizations").delete().eq("id", id);
      setSaveState(error ? `Error: ${error.message}` : "Deleted");
      if (!error) setTimeout(() => setSaveState(""), 900);
    },
    [supabase]
  );

  // Insert another auth/review for an existing patient (same name + facility).
  const addReview = useCallback(
    async (facility_id: string | null, patient_name: string) => {
      setSaveState("Adding review…");
      const { data, error } = await supabase
        .from("authorizations")
        .insert({ facility_id, patient_name, status: "Pending", updated_by: userId })
        .select()
        .single();
      if (error) {
        setSaveState(`Error: ${error.message}`);
        return;
      }
      setRows((prev) => [data as Authorization, ...prev]);
      setSaveState("Review added");
      setTimeout(() => setSaveState(""), 900);
    },
    [supabase, userId]
  );

  // Group rows by patient (facility + name), pick the most-current auth.
  const groups = useMemo<PatientGroup[]>(() => {
    const map = new Map<string, Authorization[]>();
    for (const r of rows) {
      const key = `${r.facility_id ?? ""}||${norm(r.patient_name)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const out: PatientGroup[] = [];
    for (const [key, auths] of map) {
      auths.sort((a, b) => authRecency(b) - authRecency(a));
      out.push({
        key,
        facility_id: auths[0].facility_id,
        name: auths[0].patient_name || "(no name)",
        auths,
        current: auths[0],
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      const cur = g.current;
      const dischargedNow = Boolean(cur.discharged);
      if (view === "active" && dischargedNow) return false;
      if (view === "discharged" && !dischargedNow) return false;
      if (statusFilter !== "all" && String(cur.status ?? "") !== statusFilter)
        return false;
      if (reviewFilter === "due" && !isDueForReview(cur)) return false;
      if (q) {
        const hay = [g.name, cur.auth_number, cur.level_of_care, cur.status]
          .map((x) => String(x ?? ""))
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [groups, view, statusFilter, reviewFilter, search]);

  const summary = useMemo(() => {
    const curr = filtered.map((g) => g.current);
    return {
      patients: filtered.length,
      due: curr.filter(isDueForReview).length,
      approved: curr.filter((c) => /approv/.test(norm(c.status))).length,
      pending: curr.filter((c) => /pending/.test(norm(c.status))).length,
    };
  }, [filtered]);

  const exportXlsx = () => {
    // Every auth line (not just current), with days + facility.
    const data = rows
      .filter((r) => facilityFilter === "all" || r.facility_id === facilityFilter)
      .map((r) => ({
        Facility: facName(r.facility_id),
        Patient: r.patient_name ?? "",
        "Auth #": r.auth_number ?? "",
        LOC: r.level_of_care ?? "",
        Admit: r.admit_date ?? "",
        Start: r.start_date ?? "",
        End: r.end_date ?? "",
        "Total Days": authDays(r) ?? "",
        "Next Review": r.next_review_date ?? "",
        Discharge: r.discharge_date ?? "",
        Status: r.status ?? "",
        Discharged: r.discharged ? "Yes" : "",
        Notes: r.notes ?? "",
      }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Authorizations");
    const fac = facilityFilter !== "all" ? `-${facName(facilityFilter)}` : "";
    XLSX.writeFile(wb, `authorizations${fac}.xlsx`);
  };

  const openGroup = filtered.find((g) => g.key === openKey) ?? null;

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface-card px-6 py-3">
        <select
          value={facilityFilter}
          onChange={(e) => setFacilityFilter(e.target.value)}
          className="input max-w-[14rem]"
        >
          <option value="all">All facilities</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.short_name || f.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded-lg border border-surface-border p-0.5">
          {(
            [
              ["active", "Active"],
              ["discharged", "Discharged"],
            ] as ["active" | "discharged", string][]
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

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input max-w-[11rem]"
        >
          <option value="all">All statuses</option>
          {AUTH_STATUS_OPTIONS.filter(Boolean).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={reviewFilter}
          onChange={(e) => setReviewFilter(e.target.value as "all" | "due")}
          className="input max-w-[11rem]"
        >
          <option value="all">All reviews</option>
          <option value="due">Next Review due</option>
        </select>

        <input
          placeholder="Search patient / auth #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-[16rem] flex-1"
        />

        <div className="ml-auto flex items-center gap-3 text-xs">
          {saveState && <span className="font-medium text-secured">{saveState}</span>}
          <span className="text-surface-muted">
            <b className="text-surface-ink">{filtered.length}</b> patients
          </span>
          {!readOnly && (
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              + Add patient
            </button>
          )}
          <button onClick={exportXlsx} className="btn-ghost" disabled={rows.length === 0}>
            ↓ Export
          </button>
          {isManagement && !readOnly && (
            <button onClick={() => setShowImport((s) => !s)} className="btn-gold">
              ↥ Import Excel
            </button>
          )}
        </div>
      </div>

      {showImport && (
        <ImportPanel
          config={importConfig}
          facilities={facilities}
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            load();
          }}
        />
      )}

      {!loading && (
        <div className="border-b border-surface-border bg-surface px-6 py-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SumCard label="Patients" value={String(summary.patients)} />
            <SumCard label="Next Review" value={String(summary.due)} accent="risk" />
            <SumCard label="Approved" value={String(summary.approved)} accent="recovered" />
            <SumCard label="Pending" value={String(summary.pending)} accent="gold" />
          </div>
        </div>
      )}

      {/* patient table (current auth per patient) */}
      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th sticky left-0 bg-surface">Patient</th>
              <th className="th">Facility</th>
              <th className="th">LOC</th>
              <th className="th">Status</th>
              <th className="th">Start</th>
              <th className="th">End</th>
              <th className="th text-right">Total Days</th>
              <th className="th">Next Review</th>
              <th className="th text-right"># Auths</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="td py-10 text-center text-surface-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="td py-10 text-center text-surface-muted">
                  No patients here. Use “+ Add patient” or “Import Excel.”
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((g, i) => {
                const c = g.current;
                const due = isDueForReview(c);
                return (
                  <tr
                    key={g.key}
                    className={`${i % 2 ? "bg-surface/40" : "bg-surface-card"} cursor-pointer hover:bg-command/5`}
                    onClick={() => setOpenKey(g.key)}
                  >
                    <td className="td sticky left-0 bg-inherit font-semibold text-command hover:underline">
                      {g.name}
                    </td>
                    <td className="td text-xs text-surface-muted">{facName(g.facility_id)}</td>
                    <td className="td">{c.level_of_care || "—"}</td>
                    <td className="td text-xs">{c.status || "—"}</td>
                    <td className="td text-xs">{c.start_date || "—"}</td>
                    <td className="td text-xs">{c.end_date || "—"}</td>
                    <td className="td text-right font-mono">{authDays(c) ?? "—"}</td>
                    <td className={`td text-xs ${due ? "font-semibold text-risk" : ""}`}>
                      {c.next_review_date || "—"}
                      {due && " ●"}
                    </td>
                    <td className="td text-right font-mono text-xs">{g.auths.length}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {openGroup && (
        <PatientDetail
          group={openGroup}
          facName={facName}
          isManagement={isManagement}
          readOnly={readOnly}
          onClose={() => setOpenKey(null)}
          onSave={saveField}
          onDelete={del}
          onAddReview={() => addReview(openGroup.facility_id, openGroup.name)}
        />
      )}

      {showAdd && (
        <AddPatient
          facilities={facilities}
          defaultFacility={facilityFilter !== "all" ? facilityFilter : facilities[0]?.id ?? ""}
          onClose={() => setShowAdd(false)}
          onCreate={async (facility_id, name) => {
            await addReview(facility_id, name);
            setShowAdd(false);
            setOpenKey(`${facility_id}||${norm(name)}`);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patient drill-down: LOC day totals + every auth (editable) + add review
// ---------------------------------------------------------------------------
function PatientDetail({
  group,
  facName,
  isManagement,
  readOnly,
  onClose,
  onSave,
  onDelete,
  onAddReview,
}: {
  group: PatientGroup;
  facName: (id: string | null) => string;
  isManagement: boolean;
  readOnly: boolean;
  onClose: () => void;
  onSave: (id: string, key: keyof Authorization, value: unknown) => void;
  onDelete: (id: string) => void;
  onAddReview: () => void;
}) {
  // Total days per level of care across ALL of this patient's auths.
  const locTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of group.auths) {
      const d = authDays(a);
      if (d == null) continue;
      const loc = a.level_of_care || "—";
      m.set(loc, (m.get(loc) ?? 0) + d);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [group]);

  const grandTotal = locTotals.reduce((s, [, n]) => s + n, 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-3xl flex-col bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between border-b border-surface-border px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-bold">{group.name}</h2>
            <p className="text-xs text-surface-muted">
              {facName(group.facility_id)} · {group.auths.length} authorization
              {group.auths.length === 1 ? "" : "s"}
            </p>
          </div>
          <button onClick={onClose} className="text-sm text-surface-muted hover:underline">
            Close
          </button>
        </div>

        {/* LOC day totals */}
        <div className="border-b border-surface-border bg-surface-card px-6 py-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
            Days by level of care
          </div>
          {locTotals.length === 0 ? (
            <p className="text-sm text-surface-muted">
              No day totals yet — fill in Total Days (or Start/End) on the auths below.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {locTotals.map(([loc, n]) => (
                <span key={loc} className="badge bg-command/10 text-command">
                  {loc}: <b className="ml-1">{n} days</b>
                </span>
              ))}
              <span className="badge bg-surface text-surface-ink">
                Total: <b className="ml-1">{grandTotal} days</b>
              </span>
            </div>
          )}
        </div>

        {/* auth history (newest first, editable) */}
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div className="space-y-4">
            {group.auths.map((a, idx) => (
              <AuthCard
                key={a.id}
                auth={a}
                index={group.auths.length - idx}
                readOnly={readOnly}
                isManagement={isManagement}
                onSave={onSave}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>

        {/* footer */}
        {!readOnly && (
          <div className="border-t border-surface-border px-6 py-4">
            <button onClick={onAddReview} className="btn-primary w-full">
              + Add authorization / review
            </button>
            <p className="mt-2 text-center text-xs text-surface-muted">
              Use this when the days run out or the patient steps down (e.g. PHP → IOP).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// A single editable authorization within the patient drill-down.
function AuthCard({
  auth,
  index,
  readOnly,
  isManagement,
  onSave,
  onDelete,
}: {
  auth: Authorization;
  index: number;
  readOnly: boolean;
  isManagement: boolean;
  onSave: (id: string, key: keyof Authorization, value: unknown) => void;
  onDelete: (id: string) => void;
}) {
  const computed = inclusiveDays(auth.start_date, auth.end_date);
  const due = isDueForReview(auth);

  const field = (
    label: string,
    key: keyof Authorization,
    opts: { type?: "text" | "number"; placeholder?: string } = {}
  ) => (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type={opts.type ?? "text"}
        defaultValue={auth[key] == null ? "" : String(auth[key])}
        placeholder={opts.placeholder}
        disabled={readOnly}
        onBlur={(e) => {
          const raw = e.target.value;
          const val =
            opts.type === "number"
              ? raw.trim() === ""
                ? null
                : Number(raw)
              : raw;
          if (String(auth[key] ?? "") !== String(val ?? "")) onSave(auth.id, key, val);
        }}
        className="input w-full"
      />
    </label>
  );

  return (
    <div className={`card p-4 ${auth.discharged ? "opacity-70" : ""}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="badge bg-command/10 text-command">Auth {index}</span>
          {auth.discharged && <span className="badge bg-surface text-surface-muted">Discharged</span>}
          {due && !auth.discharged && (
            <span className="badge bg-risk/10 text-risk">Review due</span>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSave(auth.id, "discharged", !auth.discharged)}
              className="rounded-md border border-surface-border px-2 py-1 text-xs font-semibold text-surface-muted hover:bg-surface"
            >
              {auth.discharged ? "Reactivate" : "Discharge"}
            </button>
            {isManagement && (
              <button
                onClick={() => onDelete(auth.id)}
                className="rounded-md border border-surface-border px-2 py-1 text-xs font-semibold text-risk hover:bg-risk/10"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">Level of care</span>
          <select
            defaultValue={auth.level_of_care ?? ""}
            disabled={readOnly}
            onChange={(e) => onSave(auth.id, "level_of_care", e.target.value)}
            className="input w-full"
          >
            {LEVEL_OF_CARE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o || "—"}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Status</span>
          <select
            defaultValue={auth.status ?? ""}
            disabled={readOnly}
            onChange={(e) => onSave(auth.id, "status", e.target.value)}
            className="input w-full"
          >
            {AUTH_STATUS_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        {field("Auth #", "auth_number")}
        {field("Admit", "admit_date", { placeholder: "M/D/YYYY" })}
        {field("Start", "start_date", { placeholder: "M/D/YYYY" })}
        {field("End", "end_date", { placeholder: "M/D/YYYY" })}
        {field("Total Days", "total_days", {
          type: "number",
          placeholder: computed != null ? `${computed} (from dates)` : "—",
        })}
        {field("Next Review", "next_review_date", { placeholder: "M/D/YYYY" })}
        {field("Discharge", "discharge_date", { placeholder: "M/D/YYYY" })}
      </div>

      <label className="mt-3 block">
        <span className="label">Notes</span>
        <textarea
          defaultValue={auth.notes ?? ""}
          disabled={readOnly}
          rows={2}
          onBlur={(e) => {
            if ((auth.notes ?? "") !== e.target.value) onSave(auth.id, "notes", e.target.value);
          }}
          className="input w-full resize-y whitespace-pre-wrap"
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-patient modal (name + facility). The first auth opens in the drill-down.
// ---------------------------------------------------------------------------
function AddPatient({
  facilities,
  defaultFacility,
  onClose,
  onCreate,
}: {
  facilities: Facility[];
  defaultFacility: string;
  onClose: () => void;
  onCreate: (facility_id: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [facility, setFacility] = useState(defaultFacility);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 font-display text-lg font-bold">Add patient</h2>
        <label className="mb-3 block">
          <span className="label">Patient name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input w-full"
            placeholder="Jane Doe"
          />
        </label>
        <label className="mb-4 block">
          <span className="label">Facility</span>
          <select
            value={facility}
            onChange={(e) => setFacility(e.target.value)}
            className="input w-full"
          >
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.short_name || f.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button
            onClick={() => name.trim() && facility && onCreate(facility, name.trim())}
            disabled={!name.trim() || !facility}
            className="btn-primary disabled:opacity-50"
          >
            Add & open
          </button>
        </div>
      </div>
    </div>
  );
}
