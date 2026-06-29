"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { money } from "@/lib/format";
import { normFacility } from "@/lib/import/parse";
import type { Facility } from "@/lib/types";

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
  //  - importKey: upsert by this column; existing rows keep their non-fact
  //    columns (notes etc.), only importFactKeys are refreshed.
  importMode?: "replace" | "append";
  importKey?: string;
  importFactKeys?: string[];
  // Optional summary/analytics block rendered above the table (uses the
  // currently-filtered rows).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderSummary?: (rows: Array<Record<string, any>>) => React.ReactNode;
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
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState("");
  const [showImport, setShowImport] = useState(false);
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
      if (q) {
        const hay = config.searchKeys
          .map((k) => String(r[k] ?? ""))
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, search, config, archiveView]);

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
          {!readOnly && (
            <button onClick={addRow} className="btn-primary">
              + {config.addLabel ?? "Add patient"}
            </button>
          )}
          <button onClick={exportXlsx} className="btn-ghost" disabled={filtered.length === 0}>
            ↓ Export
          </button>
          {!readOnly && (
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
              filtered.map((r, i) => (
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

// Default summary bar: row count, sums of money columns, and a status
// breakdown — shown at the top of every tracker page.
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
  const sums = moneyCols.map((c) => ({
    label: c.label,
    value: rows.reduce(
      (s, r) => s + (typeof r[c.key] === "number" ? (r[c.key] as number) : 0),
      0
    ),
  }));

  const statusCounts: Array<[string, number]> = [];
  if (statusKey) {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = String(r[statusKey] ?? "—") || "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    statusCounts.push(...Array.from(m.entries()).sort((a, b) => b[1] - a[1]));
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <span className="text-surface-muted">
        <b className="text-surface-ink">{rows.length}</b> rows
      </span>
      {sums.map((s) => (
        <span key={s.label} className="text-surface-muted">
          {s.label}{" "}
          <b className="font-mono text-surface-ink">{money(s.value)}</b>
        </span>
      ))}
      {statusCounts.slice(0, 6).map(([k, n]) => (
        <span key={k} className="badge bg-surface-card text-surface-muted">
          {k}: <b className="ml-1 text-surface-ink">{n}</b>
        </span>
      ))}
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
function ImportPanel({
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
      const keyed = prepared.filter((r) => r[key]);
      add(`Matching ${keyed.length} rows by ${key}…`);

      // Which keys already exist? (those keep their note columns)
      const allKeys = keyed.map((r) => String(r[key]));
      const existing = new Set<string>();
      for (const slice of chunk(allKeys, 500)) {
        const rows = await selectAll<Record<string, unknown>>(
          (f, t) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            supabase.from(config.table).select(key).in(key, slice).range(f, t) as any
        );
        for (const row of rows) existing.add(String(row[key]));
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
        if (upd % 100 === 0) add(`Updated ${upd}/${known.length} (notes kept)…`);
      }
      add(`✓ Import complete — ${known.length} updated with notes preserved.`);
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
