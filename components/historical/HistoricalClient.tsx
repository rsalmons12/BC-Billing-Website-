"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { moneyCents } from "@/lib/format";
import { parseHistorical, parsePrefixData, type HistoricalRow } from "@/lib/import/parseTrackers";
import { payerBucket, matchesPayer } from "@/lib/payer";

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
  const [payerF, setPayerF] = useState("all");
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
  // Payer families actually present in the data, so the dropdown only lists real ones.
  const payers = useMemo(
    () => Array.from(new Set(rows.map((r) => payerBucket(r.payer)))).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (stateF !== "all" && r.state !== stateF) return false;
      if (yearF !== "all" && r.year !== yearF) return false;
      if (!matchesPayer(r.payer, payerF)) return false;
      if (q) {
        const hay = `${r.prefix} ${r.payer} ${r.cpt_code} ${r.rev_code} ${r.description} ${r.code_used}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, stateF, yearF, payerF]);

  // Key for de-duping a reference row. The same prefix legitimately appears for
  // different states, years, and payers (e.g. a BCBS prefix across CA and NJ with
  // different reimbursements), so the identity is state + year + prefix + service
  // (a CPT, or a Rev code when there's no CPT) + payer — not prefix + code alone,
  // which would wrongly collapse those distinct rows.
  const keyOf = (r: {
    state?: string;
    year?: string;
    prefix?: string;
    payer?: string;
    code_used?: string;
    cpt_code?: string;
    rev_code?: string;
  }) => {
    const up = (v: unknown) => String(v ?? "").trim().toUpperCase();
    const service = up(r.code_used || r.cpt_code || r.rev_code);
    return [up(r.state), up(r.year), up(r.prefix), service, up(r.payer)].join("|");
  };

  const clearFile = () => {
    if (fileRef.current) fileRef.current.value = "";
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy("Parsing…");

    // Auto-detect: a raw "Prefix Data" claims export collapses to reference rows
    // (most-common paid per prefix+CPT); otherwise it's a pre-built reference sheet.
    const parsed: HistoricalRow[] = [];
    for (const f of files) {
      const buf = await f.arrayBuffer();
      const claims = parsePrefixData(buf);
      const chunkRows = claims.length ? claims : parseHistorical(buf);
      parsed.push(...chunkRows);
    }
    if (!parsed.length) {
      setBusy("No rows found in file.");
      clearFile();
      return;
    }

    // Collapse the file to one row per prefix+CPT (in case multiple files overlap),
    // keeping the first — parsePrefixData already picked the most-common amount.
    const fileMap = new Map<string, HistoricalRow>();
    for (const row of parsed) {
      const k = keyOf(row);
      if (!fileMap.has(k)) fileMap.set(k, row);
    }

    // Never erase, never duplicate: skip any prefix+service already in the table.
    const existing = new Set(rows.map((r) => keyOf(r)));
    const toAdd = Array.from(fileMap.values()).filter((r) => !existing.has(keyOf(r)));
    const skipped = fileMap.size - toAdd.length;

    if (toAdd.length === 0) {
      setBusy(`Nothing new — all ${fileMap.size} rows are already in your data.`);
      clearFile();
      setTimeout(() => setBusy(""), 2500);
      return;
    }

    const ok = window.confirm(
      `This file has ${fileMap.size.toLocaleString()} reference rows (prefix + CPT).\n\n` +
        `• ${toAdd.length.toLocaleString()} are NEW and will be added\n` +
        `• ${skipped.toLocaleString()} already exist and will be kept as-is (skipped)\n\n` +
        `Nothing already in your data is erased or changed. Add the ${toAdd.length.toLocaleString()} new rows?`
    );
    if (!ok) {
      setBusy("Cancelled — nothing changed.");
      clearFile();
      setTimeout(() => setBusy(""), 2000);
      return;
    }

    let n = 0;
    for (const batch of chunk(toAdd, 500)) {
      const { error } = await supabase.from("historical_data").insert(batch);
      if (error) {
        setBusy(`Error: ${error.message}`);
        return;
      }
      n += batch.length;
      setBusy(`Added ${n}/${toAdd.length}…`);
    }
    setBusy(`✓ Added ${toAdd.length} new · kept ${skipped} existing`);
    clearFile();
    load();
    setTimeout(() => setBusy(""), 2500);
  };

  const RENDER_CAP = 500;
  const shown = filtered.slice(0, RENDER_CAP);

  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
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
        <select value={payerF} onChange={(e) => setPayerF(e.target.value)} className="input max-w-[9rem]">
          <option value="all">All payers</option>
          {payers.map((p) => (
            <option key={p} value={p}>{p}</option>
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
                ↥ Upload data
              </label>
            </>
          )}
        </div>
      </div>

      {!loading && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-surface-border bg-surface px-6 py-3 text-sm">
          <span className="text-surface-muted">
            <b className="text-surface-ink">{filtered.length}</b> codes
          </span>
          <span className="text-surface-muted">
            <b className="text-surface-ink">
              {new Set(filtered.map((r) => r.prefix)).size}
            </b>{" "}
            prefixes
          </span>
          <span className="text-surface-muted">
            <b className="text-surface-ink">
              {new Set(filtered.map((r) => r.payer)).size}
            </b>{" "}
            payers
          </span>
          <span className="text-surface-muted">
            States: <b className="text-surface-ink">{states.join(", ") || "—"}</b>
          </span>
        </div>
      )}

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
                    ? "No reference data yet. Upload a Prefix Data export to build it."
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
