"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { moneyCents } from "@/lib/format";
import { parseHistorical, type HistoricalRow } from "@/lib/import/parseTrackers";

type Row = HistoricalRow & { id: string };

function chunk<T>(a: T[], n: number) {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
}

export default function HistoricalClient({ canEdit }: { canEdit: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stateF, setStateF] = useState("all");
  const [yearF, setYearF] = useState("all");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await selectAll<Row>((f, t) =>
      supabase.from("historical_data").select("*").order("prefix").range(f, t)
    );
    setRows(data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const states = useMemo(
    () => Array.from(new Set(rows.map((r) => r.state).filter(Boolean))).sort(),
    [rows]
  );
  const years = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.year).filter(Boolean))).sort((a, b) =>
        b.localeCompare(a)
      ),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (stateF !== "all" && r.state !== stateF) return false;
      if (yearF !== "all" && r.year !== yearF) return false;
      if (q) {
        const hay = `${r.prefix} ${r.payer} ${r.cpt_code} ${r.rev_code} ${r.description} ${r.code_used}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, stateF, yearF]);

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy("Parsing…");
    const parsed: HistoricalRow[] = [];
    for (const f of files) parsed.push(...parseHistorical(await f.arrayBuffer()));
    if (!parsed.length) {
      setBusy("No rows found in file.");
      return;
    }
    setBusy(`Replacing with ${parsed.length} rows…`);
    // Reference data is replaced wholesale.
    await supabase.from("historical_data").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    let n = 0;
    for (const batch of chunk(parsed, 500)) {
      const { error } = await supabase.from("historical_data").insert(batch);
      if (error) {
        setBusy(`Error: ${error.message}`);
        return;
      }
      n += batch.length;
      setBusy(`Loaded ${n}/${parsed.length}…`);
    }
    setBusy("✓ Imported");
    if (fileRef.current) fileRef.current.value = "";
    load();
    setTimeout(() => setBusy(""), 1500);
  };

  const RENDER_CAP = 500;
  const shown = filtered.slice(0, RENDER_CAP);

  const exportXlsx = () => {
    const data = filtered.map((r) => ({
      Prefix: r.prefix,
      State: r.state,
      Year: r.year,
      Payer: r.payer,
      "Code Type": r.code_type,
      "Code Used": r.code_used,
      CPT: r.cpt_code,
      Rev: r.rev_code,
      Description: r.description,
      "Billed/Day": r.billed_per_day ?? "",
      "Paid/Day": r.paid_per_day ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Historical");
    XLSX.writeFile(wb, `historical-data${stateF !== "all" ? "-" + stateF : ""}.xlsx`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface-card px-6 py-3">
        <input
          placeholder="Search prefix, payer, CPT, description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-[22rem] flex-1"
        />
        <select value={stateF} onChange={(e) => setStateF(e.target.value)} className="input max-w-[8rem]">
          <option value="all">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={yearF} onChange={(e) => setYearF(e.target.value)} className="input max-w-[8rem]">
          <option value="all">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-3 text-xs">
          {busy && <span className="font-medium text-secured">{busy}</span>}
          <span className="text-surface-muted">
            <b className="text-surface-ink">{filtered.length}</b> rows
          </span>
          <button
            onClick={exportXlsx}
            disabled={filtered.length === 0}
            className="rounded-lg border border-surface-border px-2.5 py-1.5 text-xs font-semibold text-surface-muted hover:bg-surface disabled:opacity-50"
          >
            ↓ Export
          </button>
          {canEdit && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                multiple
                onChange={onImport}
                className="hidden"
                id="hist-file"
              />
              <label htmlFor="hist-file" className="btn-gold cursor-pointer">
                ↥ Import reference
              </label>
            </>
          )}
        </div>
      </div>

      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th">Prefix</th>
              <th className="th">State</th>
              <th className="th">Year</th>
              <th className="th">Payer</th>
              <th className="th">Type</th>
              <th className="th">Code</th>
              <th className="th">CPT</th>
              <th className="th">Rev</th>
              <th className="th">Description</th>
              <th className="th text-right">Billed/Day</th>
              <th className="th text-right">Paid/Day</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={11} className="td py-10 text-center text-surface-muted">Loading…</td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="td py-10 text-center text-surface-muted">
                  {rows.length === 0
                    ? "No reference data yet. Import the BCBS prefix sheet."
                    : "No matches."}
                </td>
              </tr>
            )}
            {!loading &&
              shown.map((r, i) => (
                <tr key={r.id} className={i % 2 ? "bg-surface/40" : "bg-surface-card"}>
                  <td className="td font-mono font-semibold">{r.prefix || "—"}</td>
                  <td className="td text-xs">{r.state}</td>
                  <td className="td text-xs">{r.year}</td>
                  <td className="td">{r.payer}</td>
                  <td className="td text-xs">{r.code_type}</td>
                  <td className="td font-mono text-xs">{r.code_used}</td>
                  <td className="td font-mono text-xs">{r.cpt_code}</td>
                  <td className="td font-mono text-xs">{r.rev_code}</td>
                  <td className="td max-w-[20rem] truncate text-xs text-surface-muted">{r.description}</td>
                  <td className="td text-right font-mono">{moneyCents(r.billed_per_day)}</td>
                  <td className="td text-right font-mono text-recovered">{moneyCents(r.paid_per_day)}</td>
                </tr>
              ))}
            {!loading && filtered.length > RENDER_CAP && (
              <tr>
                <td colSpan={11} className="td py-3 text-center text-xs text-surface-muted">
                  Showing first {RENDER_CAP} of {filtered.length} — refine your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
