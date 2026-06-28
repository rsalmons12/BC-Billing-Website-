"use client";

import * as XLSX from "xlsx";

export type ExportRow = Record<string, string | number>;

export default function ExportButton({
  rows,
  filename,
  sheet = "Sheet1",
  label = "Export to Excel",
}: {
  rows: ExportRow[];
  filename: string;
  sheet?: string;
  label?: string;
}) {
  function onExport() {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet);
    XLSX.writeFile(wb, filename);
  }

  return (
    <button onClick={onExport} className="btn-gold" disabled={rows.length === 0}>
      ↓ {label}
    </button>
  );
}
