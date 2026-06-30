"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";

// Every data table worth keeping a personal copy of. Each becomes one sheet in
// a single dated Excel workbook.
const TABLES = [
  "facilities",
  "profiles",
  "assignments",
  "claims",
  "claim_work",
  "negotiations",
  "authorizations",
  "medical_records",
  "payments",
  "repricing",
  "historical_data",
  "weekly_assignments",
  "auth_issues",
  "production_log",
];

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function BackupButton() {
  const [busy, setBusy] = useState("");

  const run = async () => {
    const supabase = createClient();
    setBusy("Backing up…");
    const wb = XLSX.utils.book_new();
    let grand = 0;

    for (const t of TABLES) {
      setBusy(`Backing up ${t}…`);
      try {
        const rows = await selectAll<Record<string, unknown>>((f, to) =>
          supabase.from(t).select("*").range(f, to)
        );
        const ws = XLSX.utils.json_to_sheet(
          rows.length ? rows : [{ note: "no rows" }]
        );
        XLSX.utils.book_append_sheet(wb, ws, t.slice(0, 31));
        grand += rows.length;
      } catch {
        // Skip tables that error (e.g. don't exist) but keep the backup going.
        const ws = XLSX.utils.json_to_sheet([{ note: "could not read table" }]);
        XLSX.utils.book_append_sheet(wb, ws, t.slice(0, 31));
      }
    }

    XLSX.writeFile(wb, `bcbilling-backup-${stamp()}.xlsx`);
    setBusy(`✓ Saved ${grand.toLocaleString()} rows`);
    setTimeout(() => setBusy(""), 2500);
  };

  return (
    <button
      onClick={run}
      disabled={Boolean(busy)}
      className="btn-gold whitespace-nowrap text-sm disabled:opacity-60"
      title="Download every tab to one Excel file as your own backup"
    >
      {busy || "↓ Download everything (backup)"}
    </button>
  );
}
