"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { money } from "@/lib/format";
import { normFacility } from "@/lib/import/parse";
import { periodOf } from "@/lib/import/parseTrackers";
import type { Facility } from "@/lib/types";

// "2026-06" -> "Jun 2026" for the month dropdown.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return ym;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export type ColumnKind =
  | "text"
  | "money"
  | "num"
  | "pct"
  | "date"
  | "select"
  | "notes";

export interface ColumnDef {
  key: string;
  label: string;
  kind?: ColumnKind;
  options?: string[];
  editable?: boolean;
  min?: string; // min-width class suffix, e.g. "min-w-[10rem]"
  // Read-only derived value computed from the whole row (e.g. total, percent).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compute?: (row: Record<string, any>) => unknown;
}

export interface TrackerConfig {
  table: string;
  statusKey?: string;
  statusOptions?: string[];
  searchKeys: string[];
  columns: ColumnDef[];
  parse: (buf: ArrayBuffer) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: Array<Record<string, any> & { facility_name: string }>;
    facilities: string[];
  };
  // Import behaviour:
  //  - default: replace all rows for the mapped facilities.
  //  - importMode "append": only insert (never delete) — for historical logs.
  //  - importMode "replace_period": replace only the month(s) in the file for
  //    the mapped facilities (payments accumulate month over month). Uses
  //    the `period` column (YYYY-MM).
  //  - importKey: upsert by this column; existing rows keep their non-fact
  //    columns (notes etc.), only importFactKeys are refreshed.
  importMode?: "replace" | "append" | "replace_period";
  importKey?: string;
  importFactKeys?: string[];
  // When set, show a Month dropdown that filters rows by the month derived from
  // this date field (e.g. "deposit_date") — lets you view prior months.
  monthFrom?: string;
  // Set false for read-only "visual" reports (e.g. Billed) so the import log
  // doesn't talk about preserving notes.
  preservesNotes?: boolean;
  // Optional summary/analytics block rendered above the table (uses the
  // currently-filtered rows).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderSummary?: (rows: Array<Record<string, any>>) => React.ReactNode;
  // Optional extra dropdown filter(s) rendered next to the status filter.
  // Each option keeps only rows for which test() returns true.
  extraFilters?: {
    label: string; // dropdown placeholder, e.g. "All reviews"
    options: {
      value: string;
      label: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      test: (r: Record<string, any>) => boolean;
    }[];
  };
  // Optional boolean "bucket" column (e.g. discharged) with an Active/Archived
  // toggle and a per-row move action.
  archiveKey?: string;
  archiveLabels?: { active: string; archived: string; action: string; unaction: string };
  // Label for the add-row button (default "Add patient").
  addLabel?: string;
}

type Row = Record<string, unknown> & { id: string; facility_id: string | null };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function fmt(kind: ColumnKind | undefined, v: unknown): string {
  if (kind === "money") return money(typeof v === "number" ? v : 0);
  if (kind === "pct")
    return typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—";
  if (kind === "num") return v == null || v === "" ? "—" : String(v);
  return v == null || v === "" ? "—" : String(v);
}

export default function TrackerModule({
  facilities,
  userId,
  config,
  isManagement = false,
  readOnly = false,
}: {
  facilities: Facility[];
  userId: string;
  config: TrackerConfig;
  isManagement?: boolean;
  readOnly?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [extraFilter, setExtraFilter] = useState("all");
  const [archiveView, setArchiveView] = useState<"active" | "archived">("active");
  const hasActions = !readOnly && (Boolean(config.archiveKey) || isManagement);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await selectAll<Row>((f, t) => {
      let q = supabase
        .from(config.table)
        .select("*")
        .order("created_at", { ascending: false });
      if (facilityFilter !== "all") q = q.eq("facility_id", facilityFilter);
      return q.range(f, t);
    });
    setRows(data);
    setLoading(false);
  }, [supabase, config.table, facilityFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const saveCell = useCallback(
    async (id: string, key: string, value: unknown) => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [key]: value } : r))
      );
      setSaveState("Saving…");
      const { error } = await supabase
        .from(config.table)
        .update({ [key]: value, updated_by: userId, updated_at: new Date().toISOString() })
        .eq("id", id);
      setSaveState(error ? `Error: ${error.message}` : "Saved");
      if (!error) setTimeout(() => setSaveState(""), 1000);
    },
    [supabase, config.table, userId]
  );

  const addRow = useCallback(async () => {
    const fid =
      facilityFilter !== "all" ? facilityFilter : facilities[0]?.id ?? "";
    if (!fid) {
      setSaveState("Add a facility first");
      return;
    }
    setSaveState("Adding…");
    const { data, error } = await supabase
      .from(config.table)
      .insert({ facility_id: fid, updated_by: userId })
      .select()
      .single();
    if (error) {
      setSaveState(`Error: ${error.message}`);
      return;
    }
    // Make sure the new row is visible under the current facility filter.
    if (facilityFilter !== "all" && facilityFilter !== fid) {
      setFacilityFilter(fid);
    }
    setRows((prev) => [data as Row, ...prev]);
    setSaveState("Added — fill in the row");
    setTimeout(() => setSaveState(""), 1500);
  }, [supabase, config.table, userId, facilityFilter, facilities]);

  const facName = useCallback(
    (id: string | null) => {
      const f = facilities.find((x) => x.id === id);
      return f?.short_name || f?.name || "";
    },
    [facilities]
  );

  const del = useCallback(
    async (id: string) => {
      if (!confirm("Delete this row? This cannot be undone.")) return;
      setRows((prev) => prev.filter((r) => r.id !== id));
      const { error } = await supabase.from(config.table).delete().eq("id", id);
      setSaveState(error ? `Error: ${error.message}` : "Deleted");
      if (!error) setTimeout(() => setSaveState(""), 1000);
    },
    [supabase, config.table]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (config.archiveKey) {
        const archived = Boolean(r[config.archiveKey]);
        if (archiveView === "active" && archived) return false;
        if (archiveView === "archived" && !archived) return false;
      }
      if (
        config.statusKey &&
        statusFilter !== "all" &&
        String(r[config.statusKey] ?? "") !== statusFilter
      )
        return false;
      if (config.extraFilters && extraFilter !== "all") {
        const opt = config.extraFilters.options.find((o) => o.value === extraFilter);
        if (opt && !opt.test(r)) return false;
      }
      if (config.monthFrom && monthFilter !== "all") {
        const m = periodOf(String(r[config.monthFrom] ?? ""), String(r.period ?? ""));
        if (m !== monthFilter) return false;
      }
      if (q) {
        const hay = config.searchKeys
          .map((k) => String(r[k] ?? ""))
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, extraFilter, monthFilter, search, config, archiveView]);

  // Distinct months present in the data (newest first) for the Month dropdown.
  const monthOptions = useMemo(() => {
    if (!config.monthFrom) return [];
    const set = new Set<string>();
    for (const r of rows) {
      const m = periodOf(String(r[config.monthFrom] ?? ""), String(r.period ?? ""));
      if (m) set.add(m);
    }
    return Array.from(set).sort().reverse();
  }, [rows, config]);

  // Only render a window of rows so big tabs stay fast (totals/export still
  // use the full filtered set).
  const RENDER_CAP = 200;
  const visible = filtered.slice(0, RENDER_CAP);
  const hidden = filtered.length - visible.length;

  const exportXlsx = () => {
    const data = filtered.map((r) => {
      const o: Record<string, unknown> = { Facility: facName(r.facility_id) };
      for (const c of config.columns) o[c.label] = c.compute ? c.compute(r) : r[c.key];
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, config.table.slice(0, 28));
    const fac = facilityFilter !== "all" ? `-${facName(facilityFilter)}` : "";
    XLSX.writeFile(wb, `${config.table}${fac}.xlsx`);
  };

  // Re-file every currently-shown row to a chosen facility (management).
  const bulkReassign = async (fid: string) => {
    const ids = filtered.map((r) => r.id);
    if (!ids.length) return;
    if (!confirm(`Move ${ids.length} shown row(s) to ${facName(fid)}?`)) return;
    setSaveState("Moving…");
    for (const slice of chunk(ids, 200)) {
      const { error } = await supabase
        .from(config.table)
        .update({ facility_id: fid })
        .in("id", slice);
      if (error) {
        setSaveState(`Error: ${error.message}`);
        return;
      }
    }
    setSaveState("Moved");
    load();
  };

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

        {config.archiveKey && config.archiveLabels && (
          <div className="flex items-center gap-1 rounded-lg border border-surface-border p-0.5">
            {(
              [
                ["active", config.archiveLabels.active],
                ["archived", config.archiveLabels.archived],
              ] as ["active" | "archived", string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setArchiveView(key)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  archiveView === key
                    ? "bg-command text-command-text"
                    : "text-surface-muted hover:bg-surface"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {config.monthFrom && monthOptions.length > 0 && (
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="input max-w-[12rem]"
            title="Show a specific month (or all months)"
          >
            <option value="all">All months</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        )}

        {config.statusKey && config.statusOptions && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input max-w-[12rem]"
          >
            <option value="all">All statuses</option>
            {config.statusOptions
              .filter(Boolean)
              .map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
          </select>
        )}

        {config.extraFilters && (
          <select
            value={extraFilter}
            onChange={(e) => setExtraFilter(e.target.value)}
            className="input max-w-[12rem]"
          >
            <option value="all">{config.extraFilters.label}</option>
            {config.extraFilters.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        <input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-[16rem] flex-1"
        />

        <div className="ml-auto flex items-center gap-3 text-xs">
          {saveState && <span className="font-medium text-secured">{saveState}</span>}
          <span className="text-surface-muted">
            <b className="text-surface-ink">{filtered.length}</b> rows
          </span>
          {isManagement && !readOnly && filtered.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) bulkReassign(e.target.value);
              }}
              className="input max-w-[12rem]"
              title="Move all currently shown rows to a facility"
            >
              <option value="">Move shown → facility…</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.short_name || f.name}
                </option>
              ))}
            </select>
          )}
          {!readOnly && (
            <button onClick={addRow} className="btn-primary">
              + {config.addLabel ?? "Add patient"}
            </button>
          )}
          <button onClick={exportXlsx} className="btn-ghost" disabled={filtered.length === 0}>
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
          config={config}
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
          {config.renderSummary ? (
            config.renderSummary(filtered)
          ) : (
            <DefaultSummary
              rows={filtered}
              columns={config.columns}
              statusKey={config.statusKey}
            />
          )}
        </div>
      )}

      {/* table */}
      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th sticky left-0 bg-surface">Facility</th>
              {config.columns.map((c) => (
                <th key={c.key} className="th">
                  {c.label}
                </th>
              ))}
              {hasActions && <th className="th"></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={config.columns.length + 2} className="td py-10 text-center text-surface-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={config.columns.length + 2} className="td py-10 text-center text-surface-muted">
                  No rows yet. Use “Import Excel” to load your tracker.
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((r, i) => (
                <tr
                  key={r.id}
                  className={i % 2 ? "bg-surface/40" : "bg-surface-card"}
                >
                  <td className="td sticky left-0 bg-inherit">
                    {readOnly ? (
                      <span className="text-xs text-surface-muted">{facName(r.facility_id)}</span>
                    ) : (
                      <select
                        value={r.facility_id ?? ""}
                        onChange={(e) =>
                          saveCell(r.id, "facility_id", e.target.value || null)
                        }
                        className="cell-input min-w-[9rem] text-xs"
                      >
                        <option value="">— facility —</option>
                        {facilities.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.short_name || f.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  {config.columns.map((c) => (
                    <td key={c.key} className="td">
                      <Cell
                        col={readOnly ? { ...c, editable: false } : c}
                        value={c.compute ? c.compute(r) : r[c.key]}
                        onSave={(v) => saveCell(r.id, c.key, v)}
                      />
                    </td>
                  ))}
                  {hasActions && (
                    <td className="td whitespace-nowrap">
                      {config.archiveKey && config.archiveLabels && (
                        <button
                          onClick={() =>
                            saveCell(
                              r.id,
                              config.archiveKey!,
                              !r[config.archiveKey!]
                            )
                          }
                          className="mr-2 rounded-md border border-surface-border px-2 py-1 text-xs font-semibold text-surface-muted hover:bg-surface"
                        >
                          {r[config.archiveKey]
                            ? config.archiveLabels.unaction
                            : config.archiveLabels.action}
                        </button>
                      )}
                      {isManagement && (
                        <button
                          onClick={() => del(r.id)}
                          className="rounded-md border border-surface-border px-2 py-1 text-xs font-semibold text-risk hover:bg-risk/10"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            {!loading && hidden > 0 && (
              <tr>
                <td colSpan={config.columns.length + 2} className="td py-3 text-center text-xs text-surface-muted">
                  Showing the first {RENDER_CAP} of {filtered.length} — use the
                  facility/status filters or search to narrow. (Totals and Export
                  still cover all {filtered.length}.)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({
  col,
  value,
  onSave,
}: {
  col: ColumnDef;
  value: unknown;
  onSave: (v: unknown) => void;
}) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => setV(value == null ? "" : String(value)), [value]);

  if (!col.editable) {
    return (
      <span
        className={
          col.kind === "money" || col.kind === "num" || col.kind === "pct"
            ? "font-mono"
            : ""
        }
      >
        {fmt(col.kind, value)}
      </span>
    );
  }

  if (col.kind === "select") {
    return (
      <select
        value={String(value ?? "")}
        onChange={(e) => onSave(e.target.value)}
        className={`cell-input ${col.min ?? "min-w-[8rem]"}`}
      >
        {(col.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o || "—"}
          </option>
        ))}
      </select>
    );
  }

  const commit = () => {
    if (col.kind === "money" || col.kind === "num" || col.kind === "pct") {
      const n = v === "" ? null : parseFloat(v.replace(/[$,%]/g, ""));
      onSave(n == null || isNaN(n) ? null : n);
    } else {
      onSave(v);
    }
  };

  if (col.kind === "notes") {
    return (
      <AutoTextarea
        value={v}
        onChange={setV}
        onBlur={() => v !== String(value ?? "") && commit()}
        className="min-w-[18rem] max-w-[28rem]"
      />
    );
  }

  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== String(value ?? "") && commit()}
      className={`cell-input ${col.min ?? "min-w-[7rem]"} ${
        col.kind === "money" || col.kind === "num" ? "font-mono" : ""
      }`}
    />
  );
}

// Summary card (matches the Payments cards).
export function SumCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "recovered" | "gold" | "risk" | "secured";
}) {
  const color =
    accent === "recovered"
      ? "text-recovered"
      : accent === "gold"
        ? "text-gold"
        : accent === "risk"
          ? "text-risk"
          : accent === "secured"
            ? "text-secured"
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

// Default card summary: a Rows card, one card per money column, and (when there
// are no money columns) cards for the status breakdown.
function DefaultSummary({
  rows,
  columns,
  statusKey,
}: {
  rows: Array<Record<string, unknown>>;
  columns: ColumnDef[];
  statusKey?: string;
}) {
  const moneyCols = columns.filter((c) => c.kind === "money" && !c.compute);
  const sum = (key: string) =>
    rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);

  const cards: { label: string; value: string; accent?: "gold" }[] = [
    { label: "Rows", value: String(rows.length) },
    ...moneyCols.slice(0, 3).map((c) => ({
      label: c.label,
      value: money(sum(c.key)),
      accent: "gold" as const,
    })),
  ];

  // Status breakdown (counts). Shown as cards when there are no money columns,
  // otherwise as small chips below.
  const statusCounts: Array<[string, number]> = [];
  if (statusKey) {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = String(r[statusKey] ?? "—") || "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    statusCounts.push(...Array.from(m.entries()).sort((a, b) => b[1] - a[1]));
  }
  if (moneyCols.length === 0 && statusCounts.length) {
    for (const [k, n] of statusCounts.slice(0, 3)) {
      cards.push({ label: k, value: String(n) });
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <SumCard key={c.label} label={c.label} value={c.value} accent={c.accent} />
        ))}
      </div>
      {moneyCols.length > 0 && statusCounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {statusCounts.slice(0, 6).map(([k, n]) => (
            <span key={k} className="badge bg-surface-card text-surface-muted">
              {k}: <b className="ml-1 text-surface-ink">{n}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// A textarea that auto-grows and wraps so the full text is always visible.
function AutoTextarea({
  value,
  onChange,
  onBlur,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  className?: string;
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
      className={`cell-input resize-none overflow-hidden whitespace-pre-wrap break-words leading-snug ${className}`}
    />
  );
}

// ----- import panel (parse -> map facilities -> replace per facility) -----
export function ImportPanel({
  config,
  facilities,
  onClose,
  onDone,
}: {
  config: TrackerConfig;
  facilities: Facility[];
  onClose: () => void;
  onDone: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [parsed, setParsed] = useState<ReturnType<TrackerConfig["parse"]> | null>(
    null
  );
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const autoMatch = (name: string): string => {
    const n = normFacility(name);
    if (!n) return "";
    for (const f of facilities)
      if (normFacility(f.name) === n || (f.short_name && normFacility(f.short_name) === n))
        return f.id;
    for (const f of facilities) {
      const fn = normFacility(f.name);
      const sn = f.short_name ? normFacility(f.short_name) : "";
      if (fn.includes(n) || n.includes(fn) || (sn && (sn.includes(n) || n.includes(sn))))
        return f.id;
    }
    return "";
  };

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const mergedRows: Array<Record<string, unknown> & { facility_name: string }> = [];
    for (const file of files) {
      const result = config.parse(await file.arrayBuffer());
      mergedRows.push(...result.rows);
    }
    const merged = {
      rows: mergedRows,
      facilities: Array.from(new Set(mergedRows.map((r) => r.facility_name))),
    };
    setParsed(merged);
    const m: Record<string, string> = {};
    for (const name of merged.facilities) m[name] = autoMatch(name);
    setMapping(m);
  }

  async function commit() {
    if (!parsed) return;
    setBusy(true);
    setLog([]);
    const add = (s: string) => setLog((l) => [...l, s]);

    const prepared = parsed.rows
      .map((r) => {
        const fid = mapping[r.facility_name];
        if (!fid) return null;
        const { facility_name, ...rest } = r;
        return { ...rest, facility_id: fid };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (prepared.length === 0) {
      add("No rows mapped to a facility.");
      setBusy(false);
      return;
    }

    const touched = Array.from(
      new Set(prepared.map((r) => r.facility_id as string))
    );

    // ----- Mode 1: upsert by a stable key, preserving collector edits -----
    if (config.importKey) {
      const key = config.importKey;
      const factKeys = config.importFactKeys ?? [];
      // De-dupe within this import by the key (last wins). When several files
      // are uploaded together — e.g. pulling every facility/instance from
      // CollaborateMD at once — an overlapping claim id must not be inserted
      // twice (which would violate the unique key).
      const dedup = new Map<string, Record<string, unknown>>();
      for (const r of prepared) {
        if (r[key]) dedup.set(String(r[key]), r);
      }
      const keyed = Array.from(dedup.values());
      add(`Matching ${keyed.length} rows by ${key}…`);

      // Which keys already exist? (those keep their note columns)
      const allKeys = keyed.map((r) => String(r[key]));
      const existing = new Set<string>();
      try {
        for (const slice of chunk(allKeys, 500)) {
          const rows = await selectAll<Record<string, unknown>>(
            (f, t) =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              supabase.from(config.table).select(key).in(key, slice).range(f, t) as any
          );
          for (const row of rows) existing.add(String(row[key]));
        }
      } catch (e) {
        add(
          `Error reading ${config.table}: ${
            e instanceof Error ? e.message : "unknown"
          }. The ${config.table} table may be missing — run supabase/migrations/ALL.sql.`
        );
        setBusy(false);
        return;
      }

      const fresh = keyed.filter((r) => !existing.has(String(r[key])));
      const known = keyed.filter((r) => existing.has(String(r[key])));

      // New claims: insert the full row (brings the file's notes once).
      for (const batch of chunk(fresh, 400)) {
        const { error } = await supabase.from(config.table).insert(batch);
        if (error) {
          add(`Error inserting new: ${error.message}`);
          setBusy(false);
          return;
        }
      }
      add(`${fresh.length} new added.`);

      // Existing claims: refresh only the imported facts; notes are preserved.
      let upd = 0;
      for (const r of known) {
        const factPayload: Record<string, unknown> = {};
        for (const fk of factKeys) factPayload[fk] = r[fk];
        const { error } = await supabase
          .from(config.table)
          .update(factPayload)
          .eq(key, r[key] as string);
        if (error) {
          add(`Error updating ${r[key]}: ${error.message}`);
          setBusy(false);
          return;
        }
        upd++;
        const kept = config.preservesNotes === false ? "" : " (notes kept)";
        if (upd % 100 === 0) add(`Updated ${upd}/${known.length}${kept}…`);
      }
      const notePreserved =
        config.preservesNotes === false ? "" : " with notes preserved";
      add(`✓ Import complete — ${known.length} updated${notePreserved}.`);
      setBusy(false);
      setTimeout(onDone, 800);
      return;
    }

    // ----- Mode 1b: replace only the month(s) in the file (accumulate) -----
    // For payments: importing June replaces June's rows for the touched
    // facilities and leaves every other month intact; re-importing a month
    // refreshes just that month. Never touches other months.
    if (config.importMode === "replace_period") {
      const periods = Array.from(
        new Set(prepared.map((r) => String(r.period || "")).filter(Boolean))
      );
      if (periods.length === 0) {
        add("Couldn't read a month (deposit date) from this file — nothing imported.");
        setBusy(false);
        return;
      }
      const facLabels = touched
        .map((id) => {
          const f = facilities.find((x) => x.id === id);
          return f?.short_name || f?.name || id;
        })
        .join(", ");
      if (
        !confirm(
          `Add / refresh month(s): ${periods.join(", ")}\n` +
            `for: ${facLabels}\n\n` +
            `Other months stay exactly as they are. Continue?`
        )
      ) {
        add("Import cancelled — nothing was changed.");
        setBusy(false);
        return;
      }
      // Delete just the touched facilities' rows for these month(s), then insert.
      // Also sweep any pre-tagged rows (period is null) left from before months
      // were tracked, so old data doesn't linger as duplicates.
      for (const fids of chunk(touched, 50)) {
        const { error } = await supabase
          .from(config.table)
          .delete()
          .in("facility_id", fids)
          .or(`period.in.(${periods.join(",")}),period.is.null`);
        if (error) {
          add(`Error clearing month(s): ${error.message}`);
          setBusy(false);
          return;
        }
      }
      let inserted = 0;
      for (const batch of chunk(prepared, 400)) {
        const { error } = await supabase.from(config.table).insert(batch);
        if (error) {
          add(`Error inserting: ${error.message}`);
          setBusy(false);
          return;
        }
        inserted += batch.length;
        add(`Added ${inserted}/${prepared.length}…`);
      }
      add(`✓ Import complete — month(s) ${periods.join(", ")} added; other months untouched.`);
      setBusy(false);
      setTimeout(onDone, 800);
      return;
    }

    // ----- Mode 2: append-only (never delete — historical log) -----
    if (config.importMode === "append") {
      let inserted = 0;
      for (const batch of chunk(prepared, 400)) {
        const { error } = await supabase.from(config.table).insert(batch);
        if (error) {
          add(`Error inserting: ${error.message}`);
          setBusy(false);
          return;
        }
        inserted += batch.length;
        add(`Added ${inserted}/${prepared.length}…`);
      }
      add("✓ Import complete (appended, nothing deleted).");
      setBusy(false);
      setTimeout(onDone, 800);
      return;
    }

    // ----- Mode 3 (default): replace all rows for the touched facilities -----
    // This is destructive: it deletes EVERY existing row for each facility in
    // the file (including hand-added rows / edits) and inserts the file's rows.
    // Make the operator confirm with the exact counts first.
    let existingCount = 0;
    try {
      for (const fids of chunk(touched, 50)) {
        const { count } = await supabase
          .from(config.table)
          .select("id", { count: "exact", head: true })
          .in("facility_id", fids);
        existingCount += count ?? 0;
      }
    } catch {
      /* counting is best-effort; fall through to the confirm anyway */
    }
    const facLabels = touched
      .map((id) => {
        const f = facilities.find((x) => x.id === id);
        return f?.short_name || f?.name || id;
      })
      .join(", ");
    if (
      !confirm(
        `Replace import — please confirm.\n\n` +
          `This will DELETE all ${existingCount} existing row(s) for: ${facLabels}\n` +
          `and replace them with ${prepared.length} row(s) from this file.\n\n` +
          `Any rows or edits for those facilities that are NOT in this file will be lost. Continue?`
      )
    ) {
      add("Import cancelled — nothing was changed.");
      setBusy(false);
      return;
    }
    add(`Refreshing ${prepared.length} rows across ${touched.length} facilities…`);
    for (const fids of chunk(touched, 50)) {
      const { error } = await supabase
        .from(config.table)
        .delete()
        .in("facility_id", fids);
      if (error) {
        add(`Error clearing old rows: ${error.message}`);
        setBusy(false);
        return;
      }
    }

    let inserted = 0;
    for (const batch of chunk(prepared, 400)) {
      const { error } = await supabase.from(config.table).insert(batch);
      if (error) {
        add(`Error inserting: ${error.message}`);
        setBusy(false);
        return;
      }
      inserted += batch.length;
      add(`Inserted ${inserted}/${prepared.length}…`);
    }
    add("✓ Import complete.");
    setBusy(false);
    setTimeout(onDone, 800);
  }

  return (
    <div className="border-b border-surface-border bg-surface px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display font-bold">Import {config.table.replace("_", " ")}</h3>
        <button onClick={onClose} className="text-sm text-surface-muted hover:underline">
          Close
        </button>
      </div>

      <input
        type="file"
        accept=".xlsx,.xls,.xlsm"
        multiple
        onChange={onFile}
        className="mb-3 block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-command file:px-4 file:py-2 file:text-sm file:font-semibold file:text-command-text"
      />

      {parsed && (
        <>
          <p className="mb-2 text-sm text-surface-muted">
            Parsed <b className="text-surface-ink">{parsed.rows.length}</b> rows
            across {parsed.facilities.length} groups. Map each to a facility
            (unmapped groups are skipped). Importing <b>replaces</b> existing rows
            for the mapped facilities.
          </p>
          <div className="mb-3 max-h-48 overflow-auto rounded-lg border border-surface-border bg-surface-card">
            <table className="w-full text-sm">
              <tbody>
                {parsed.facilities.map((name) => (
                  <tr key={name} className="border-b border-surface-border last:border-0">
                    <td className="td">{name || "(blank)"}</td>
                    <td className="td">
                      <select
                        value={mapping[name] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [name]: e.target.value }))
                        }
                        className={`input max-w-[16rem] ${mapping[name] ? "" : "border-risk text-risk"}`}
                      >
                        <option value="">— skip —</option>
                        {facilities.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.short_name || f.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={commit} disabled={busy} className="btn-primary">
            {busy ? "Importing…" : "Commit import"}
          </button>
        </>
      )}

      {log.length > 0 && (
        <div className="mt-3 rounded-lg bg-command p-3 font-mono text-xs text-command-text">
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
