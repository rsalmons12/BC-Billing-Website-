import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createAdminClient } from "@/lib/supabase/admin";

// Tables to include in the daily backup (mirrors BackupButton.tsx).
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

const PAGE_SIZE = 1000;

async function selectAll(
  supabase: ReturnType<typeof createAdminClient>,
  table: string
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Vercel Cron calls this as GET. Protected by CRON_SECRET header check.
export async function GET(request: Request) {
  // Verify the request is from Vercel Cron (or an admin with the secret).
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (authHeader !== "Bearer " + cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const wb = XLSX.utils.book_new();
  let grand = 0;
  const errors: string[] = [];

  for (const t of TABLES) {
    try {
      const rows = await selectAll(supabase, t);
      const ws = XLSX.utils.json_to_sheet(
        rows.length ? rows : [{ note: "no rows" }]
      );
      XLSX.utils.book_append_sheet(wb, ws, t.slice(0, 31));
      grand += rows.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${t}: ${msg}`);
      const ws = XLSX.utils.json_to_sheet([{ note: "could not read table" }]);
      XLSX.utils.book_append_sheet(wb, ws, t.slice(0, 31));
    }
  }

  // Write workbook to a buffer and upload to Supabase Storage.
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = `bcbilling-backup-${stamp()}.xlsx`;

  const { error: uploadError } = await supabase.storage
    .from("backups")
    .upload(filename, buf, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}`, tableErrors: errors },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    filename,
    rows: grand,
    tableErrors: errors.length ? errors : undefined,
  });
}
