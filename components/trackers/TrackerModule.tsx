"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
}: {
  facilities: Facility[];
  userId: string;
  config: TrackerConfig;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState("");
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from(config.table).select("*").order("created_at", {
      ascending: false,
    });
    if (facilityFilter !== "all") q = q.eq("facility_id", facilityFilter);
    const { data } = await q;
    setRows((data as Row[]) ?? []);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
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
  }, [rows, statusFilter, search, config]);

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
          <button onClick={addRow} className="btn-primary">
            + Add patient
          </button>
          <button onClick={() => setShowImport((s) => !s)} className="btn-gold">
            ↥ Import Excel
          </button>
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
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={config.columns.length + 1} className="td py-10 text-center text-surface-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={config.columns.length + 1} className="td py-10 text-center text-surface-muted">
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
                  </td>
                  {config.columns.map((c) => (
                    <td key={c.key} className="td">
                      <Cell
                        col={c}
                        value={c.compute ? c.compute(r) : r[c.key]}
                        onSave={(v) => saveCell(r.id, c.key, v)}
                      />
                    </td>
                  ))}
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
    add(`Refreshing ${prepared.length} rows across ${touched.length} facilities…`);

    // Replace model: clear existing rows for the touched facilities, then insert.
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
