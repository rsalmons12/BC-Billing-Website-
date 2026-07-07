"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { money } from "@/lib/format";
import {
  parseWorkbook,
  normFacility,
  type ParseResult,
  type ParsedClaim,
} from "@/lib/import/parse";
import type { Facility } from "@/lib/types";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function ImportClient({ facilities }: { facilities: Facility[] }) {
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [week, setWeek] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  });
  // distinct facility name -> chosen facility_id ("" = skip)
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const addLog = (m: string) => setLog((l) => [...l, m]);

  // Auto-match a parsed facility name against known facilities. Only auto-maps
  // when it's UNambiguous — two similarly-named facilities leave it unmapped so
  // the operator picks (prevents merging e.g. Pathways Treatment + Behavioral).
  const autoMatch = (name: string): string => {
    const n = normFacility(name);
    if (!n) return "";
    const exact = facilities.filter(
      (f) => normFacility(f.name) === n || (f.short_name && normFacility(f.short_name) === n)
    );
    if (exact.length === 1) return exact[0].id;
    if (exact.length > 1) return "";
    const fuzzy = facilities.filter((f) => {
      const fn = normFacility(f.name);
      const sn = f.short_name ? normFacility(f.short_name) : "";
      return fn.includes(n) || n.includes(fn) || (!!sn && (sn.includes(n) || n.includes(sn)));
    });
    return fuzzy.length === 1 ? fuzzy[0].id : "";
  };

  const distinctFacilities = useMemo(() => {
    if (!parsed) return [];
    const set = new Map<string, number>();
    for (const c of parsed.claims) {
      set.set(c.facility_name, (set.get(c.facility_name) ?? 0) + 1);
    }
    return Array.from(set.entries()).map(([name, count]) => ({ name, count }));
  }, [parsed]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setFileName(
      files.length === 1 ? files[0].name : `${files.length} files`
    );
    setDone(false);
    setLog([]);

    // Parse every selected file and merge them (e.g. two collection sheets
    // with different facilities, same layout).
    const merged: ParseResult = {
      format: "unknown",
      claims: [],
      notesNotInCurrent: [],
      collectorAssignments: [],
      skippedVmah: 0,
      sheetsParsed: [],
    };
    for (const file of files) {
      const result = parseWorkbook(await file.arrayBuffer());
      if (merged.format === "unknown") merged.format = result.format;
      merged.claims.push(...result.claims);
      merged.notesNotInCurrent.push(...result.notesNotInCurrent);
      merged.collectorAssignments.push(...result.collectorAssignments);
      merged.skippedVmah += result.skippedVmah;
      merged.sheetsParsed.push(...result.sheetsParsed);
    }

    setParsed(merged);
    const m: Record<string, string> = {};
    const names = new Set(merged.claims.map((c) => c.facility_name));
    for (const name of names) m[name] = autoMatch(name);
    setMapping(m);
  }

  const summary = useMemo(() => {
    if (!parsed) return null;
    let charge = 0;
    let balance = 0;
    let mapped = 0;
    for (const c of parsed.claims) {
      charge += c.charge_amount ?? 0;
      balance += c.balance ?? 0;
      if (mapping[c.facility_name]) mapped++;
    }
    return { charge, balance, mapped, total: parsed.claims.length };
  }, [parsed, mapping]);

  async function commit() {
    if (!parsed) return;
    setBusy(true);
    setLog([]);
    setDone(false);

    // Collapse duplicate Claim IDs (a file can list the same claim on multiple
    // rows). Keep the last occurrence per claim_id; Postgres can't upsert the
    // same conflict key twice in one statement.
    const byId = new Map<string, ParsedClaim & { facility_id: string }>();
    let mappedRows = 0;
    for (const c of parsed.claims) {
      const fid = mapping[c.facility_name];
      if (!fid) continue;
      mappedRows++;
      byId.set(c.claim_id, { ...c, facility_id: fid });
    }
    const claimsToWrite = Array.from(byId.values());
    if (claimsToWrite.length === 0) {
      addLog("Nothing to import — no facilities mapped.");
      setBusy(false);
      return;
    }
    const dupes = mappedRows - claimsToWrite.length;
    if (dupes > 0) {
      addLog(`Collapsed ${dupes} duplicate Claim ID rows.`);
    }

    const touchedFacilityIds = Array.from(
      new Set(claimsToWrite.map((c) => c.facility_id))
    );
    const importedIds = new Set(claimsToWrite.map((c) => c.claim_id));

    addLog(
      `Mapped ${claimsToWrite.length} claims across ${touchedFacilityIds.length} facilities.`
    );

    // Existing claim_ids in touched facilities (to detect brand-new + dropoffs).
    const existing = new Set<string>();
    for (const fids of chunk(touchedFacilityIds, 50)) {
      const rows = await selectAll<{ claim_id: string }>((f, t) =>
        supabase.from("claims").select("claim_id").in("facility_id", fids).range(f, t)
      );
      for (const row of rows) existing.add(row.claim_id);
    }
    const brandNew = claimsToWrite.filter((c) => !existing.has(c.claim_id));
    addLog(`${brandNew.length} brand-new claims, ${claimsToWrite.length - brandNew.length} existing.`);

    // Upsert claim facts.
    const nowIso = new Date().toISOString();
    let upserted = 0;
    for (const batch of chunk(claimsToWrite, 400)) {
      const rows = batch.map((c) => ({
        claim_id: c.claim_id,
        facility_id: c.facility_id,
        patient_name: c.patient_name || null,
        member_id: c.member_id || null,
        dos_from: c.dos_from || null,
        dos_to: c.dos_to || null,
        charge_amount: c.charge_amount,
        balance: c.balance,
        age_days: c.age_days,
        bucket: c.bucket || null,
        claim_status: c.claim_status || null,
        week,
        present: true,
        updated_at: nowIso,
      }));
      const { error } = await supabase
        .from("claims")
        .upsert(rows, { onConflict: "claim_id" });
      if (error) {
        addLog(`Error upserting claims: ${error.message}`);
        setBusy(false);
        return;
      }
      upserted += rows.length;
      addLog(`Upserted ${upserted}/${claimsToWrite.length} claims…`);
    }

    // Seed claim_work notes ONLY for brand-new claim_ids (never overwrite).
    const seeds = brandNew
      .filter((c) => c.notes || c.initials)
      .map((c) => ({
        claim_id: c.claim_id,
        notes: c.notes || "",
        initials: c.initials || "",
        updated_at: nowIso,
      }));
    if (seeds.length) {
      for (const batch of chunk(seeds, 400)) {
        const { error } = await supabase
          .from("claim_work")
          .upsert(batch, { onConflict: "claim_id", ignoreDuplicates: true });
        if (error) addLog(`Note-seed warning: ${error.message}`);
      }
      addLog(`Seeded notes for ${seeds.length} new claims.`);
    }

    // Mark dropoffs: present=false for claims in touched facilities not in this file.
    const dropoffs: string[] = [];
    for (const fids of chunk(touchedFacilityIds, 50)) {
      const rows = await selectAll<{ claim_id: string }>((f, t) =>
        supabase
          .from("claims")
          .select("claim_id")
          .in("facility_id", fids)
          .eq("present", true)
          .range(f, t)
      );
      for (const row of rows) {
        if (!importedIds.has(row.claim_id)) dropoffs.push(row.claim_id);
      }
    }
    if (dropoffs.length) {
      for (const batch of chunk(dropoffs, 200)) {
        const { error } = await supabase
          .from("claims")
          .update({ present: false, updated_at: nowIso })
          .in("claim_id", batch);
        if (error) addLog(`Dropoff warning: ${error.message}`);
      }
      addLog(`Marked ${dropoffs.length} claims as no longer present.`);
    }

    addLog("✓ Import complete. Notes were preserved across the re-import.");
    setBusy(false);
    setDone(true);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Uploader */}
      <div className="card p-6">
        <h2 className="mb-1 font-display text-lg font-bold">Upload weekly file</h2>
        <p className="mb-4 text-sm text-surface-muted">
          Supports the raw flat export and the grouped per-facility report.
          Member IDs starting <code className="font-mono">VMAH</code> are excluded.
          Collector notes are matched by Claim ID and never overwritten.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="label">Week label</span>
            <input
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              className="input w-44"
            />
          </div>
          <div className="flex-1">
            <span className="label">Excel file (.xlsx)</span>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              multiple
              onChange={onFile}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-command file:px-4 file:py-2 file:text-sm file:font-semibold file:text-command-text hover:file:bg-command-surface"
            />
          </div>
        </div>
      </div>

      {parsed && summary && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Mini label="Format" value={parsed.format} />
            <Mini label="Claims parsed" value={String(summary.total)} />
            <Mini label="Total charge" value={money(summary.charge)} />
            <Mini label="VMAH excluded" value={String(parsed.skippedVmah)} />
          </div>

          {/* Facility mapping */}
          <div className="card overflow-hidden">
            <div className="border-b border-surface-border px-5 py-3 font-semibold">
              Facility mapping{" "}
              <span className="text-sm font-normal text-surface-muted">
                — match each office/tab to a facility
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr>
                  <th className="th">From file</th>
                  <th className="th">Claims</th>
                  <th className="th">Maps to facility</th>
                </tr>
              </thead>
              <tbody>
                {distinctFacilities.map(({ name, count }, idx) => (
                  <tr key={name} className={idx % 2 ? "bg-surface/40" : ""}>
                    <td className="td font-medium">{name || "(blank)"}</td>
                    <td className="td">{count}</td>
                    <td className="td">
                      <select
                        value={mapping[name] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [name]: e.target.value }))
                        }
                        className={`input max-w-[18rem] ${
                          mapping[name] ? "" : "border-risk text-risk"
                        }`}
                      >
                        <option value="">— skip (not mapped) —</option>
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

          {parsed.collectorAssignments.length > 0 && (
            <div className="card p-4 text-sm">
              <div className="label">
                Collector assignments found ({parsed.collectorAssignments.length})
              </div>
              <p className="text-surface-muted">
                {parsed.collectorAssignments
                  .map((c) => `${c.facility}: ${c.collectors.join(", ")}`)
                  .join(" · ")}
              </p>
              <p className="mt-1 text-xs text-surface-muted">
                Review and apply these in Admin → Users (assignment chips).
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={commit}
              disabled={busy || summary.mapped === 0}
              className="btn-gold"
            >
              {busy
                ? "Importing…"
                : `Commit import (${summary.mapped} mapped claims)`}
            </button>
            {summary.mapped < summary.total && (
              <span className="text-xs text-risk">
                {summary.total - summary.mapped} claims are unmapped and will be
                skipped.
              </span>
            )}
            {done && (
              <span className="text-sm font-semibold text-recovered">
                ✓ Done
              </span>
            )}
          </div>
        </>
      )}

      {log.length > 0 && (
        <div className="card bg-command p-4 font-mono text-xs text-command-text">
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="font-display text-xl font-bold capitalize">{value}</div>
    </div>
  );
}
