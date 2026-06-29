"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { AUTH_ISSUE_STATUSES } from "@/lib/constants";
import type { AuthIssue, Facility } from "@/lib/types";

type View = "active" | "completed";

export default function AuthIssuesClient({
  facilities,
}: {
  facilities: Facility[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const facMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of facilities) m[f.id] = f.short_name || f.name;
    return m;
  }, [facilities]);

  const [issues, setIssues] = useState<AuthIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("active");
  const [saveState, setSaveState] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("auth_issues")
      .select("*")
      .order("created_at", { ascending: false });
    setIssues((data as AuthIssue[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback(
    async (issue: AuthIssue, partial: Partial<AuthIssue>) => {
      setIssues((prev) =>
        prev.map((i) => (i.id === issue.id ? { ...i, ...partial } : i))
      );
      setSaveState("Saving…");
      const { error } = await supabase
        .from("auth_issues")
        .update(partial)
        .eq("id", issue.id);
      setSaveState(error ? `Error: ${error.message}` : "Saved");
      if (!error) setTimeout(() => setSaveState(""), 1000);
    },
    [supabase]
  );

  // Completing an auth issue writes back to the source claim's work layer.
  const complete = useCallback(
    async (issue: AuthIssue) => {
      const completedAt = new Date().toISOString();
      await patch(issue, { status: "Completed", completed_at: completedAt });

      if (issue.claim_id) {
        setSaveState("Returning to collector…");
        const { error } = await supabase
          .from("claim_work")
          .update({
            auth_issue_status: "completed",
            auth_notes: issue.notes ?? "",
            updated_at: completedAt,
          })
          .eq("claim_id", issue.claim_id);
        setSaveState(error ? `Error: ${error.message}` : "Completed & returned");
        if (!error) setTimeout(() => setSaveState(""), 1500);
      }
    },
    [patch, supabase]
  );

  const onStatusChange = (issue: AuthIssue, status: string) => {
    if (status === "Completed") {
      complete(issue);
    } else {
      patch(issue, { status, completed_at: null });
    }
  };

  const shown = useMemo(
    () =>
      issues.filter((i) =>
        view === "completed"
          ? i.status === "Completed"
          : i.status !== "Completed"
      ),
    [issues, view]
  );

  const totals = useMemo(() => {
    let atRisk = 0;
    let mgmt = 0;
    for (const i of shown) {
      atRisk += i.charge_amount ?? 0;
      if (i.mgmt_needed) mgmt++;
    }
    return { atRisk, mgmt, count: shown.length };
  }, [shown]);

  const exportXlsx = () => {
    const data = shown.map((i) => ({
      Patient: i.patient_name ?? "",
      Facility: (i.facility_id && facMap[i.facility_id]) || "",
      Payer: i.payer ?? "",
      "DOS From": i.dos_from ?? "",
      "DOS To": i.dos_to ?? "",
      Amount: i.charge_amount ?? 0,
      Source: i.from_collection ? "Collections" : "Manual",
      Status: i.status,
      Mgmt: i.mgmt_needed ? "Y" : "",
      Notes: i.notes ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Auth Issues");
    XLSX.writeFile(wb, `auth-issues-${view}.xlsx`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface-card px-6 py-3">
        <div className="flex items-center gap-1 rounded-lg border border-surface-border p-0.5">
          {(
            [
              ["active", "Active"],
              ["completed", "Completed"],
            ] as [View, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                view === key
                  ? "bg-secured text-white"
                  : "text-surface-muted hover:bg-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={exportXlsx}
          disabled={shown.length === 0}
          className="rounded-lg border border-surface-border px-2.5 py-1.5 text-xs font-semibold text-surface-muted hover:bg-surface disabled:opacity-50"
        >
          ↓ Export
        </button>
        <div className="ml-auto flex items-center gap-4 text-xs">
          {saveState && (
            <span className="font-medium text-secured">{saveState}</span>
          )}
          <span className="text-surface-muted">
            <b className="text-surface-ink">{totals.count}</b> issues
          </span>
          <span className="text-surface-muted">
            $ at stake{" "}
            <b className="font-mono text-surface-ink">{money(totals.atRisk)}</b>
          </span>
          <span className="text-surface-muted">
            Mgmt <b className="text-gold">{totals.mgmt}</b>
          </span>
        </div>
      </div>

      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th">Patient</th>
              <th className="th">Facility</th>
              <th className="th">Payer</th>
              <th className="th">DOS</th>
              <th className="th text-right">Amount</th>
              <th className="th">Source</th>
              <th className="th">Status</th>
              <th className="th">Mgmt</th>
              <th className="th min-w-[20rem]">Notes</th>
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
            {!loading && shown.length === 0 && (
              <tr>
                <td colSpan={9} className="td py-10 text-center text-surface-muted">
                  No {view} auth issues.
                </td>
              </tr>
            )}
            {!loading &&
              shown.map((i, idx) => (
                <tr
                  key={i.id}
                  className={idx % 2 ? "bg-surface/40" : "bg-surface-card"}
                >
                  <td className="td font-medium">{i.patient_name || "—"}</td>
                  <td className="td text-xs text-surface-muted">
                    {(i.facility_id && facMap[i.facility_id]) || "—"}
                  </td>
                  <td className="td text-xs">{i.payer || "—"}</td>
                  <td className="td text-xs text-surface-muted">
                    {i.dos_from || "—"}
                    {i.dos_to ? `–${i.dos_to}` : ""}
                  </td>
                  <td className="td text-right font-mono">
                    {money(i.charge_amount)}
                  </td>
                  <td className="td">
                    {i.from_collection ? (
                      <span className="badge bg-secured/12 text-secured">
                        Collections
                      </span>
                    ) : (
                      <span className="badge bg-surface text-surface-muted">
                        Manual
                      </span>
                    )}
                  </td>
                  <td className="td">
                    <select
                      value={i.status}
                      onChange={(e) => onStatusChange(i, e.target.value)}
                      className={`cell-input min-w-[8rem] ${
                        i.status === "Completed"
                          ? "text-recovered font-semibold"
                          : i.status === "Working"
                            ? "text-gold font-semibold"
                            : ""
                      }`}
                    >
                      {AUTH_ISSUE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="td text-center">
                    <input
                      type="checkbox"
                      checked={i.mgmt_needed}
                      onChange={(e) =>
                        patch(i, { mgmt_needed: e.target.checked })
                      }
                      className="h-4 w-4 accent-gold"
                    />
                  </td>
                  <td className="td">
                    <NotesCell
                      value={i.notes ?? ""}
                      onSave={(v) => patch(i, { notes: v })}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NotesCell({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      rows={1}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      className="cell-input min-h-[2rem] min-w-[20rem] resize-y leading-snug"
      placeholder="Auth team notes…"
    />
  );
}
