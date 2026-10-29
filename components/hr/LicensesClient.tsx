"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import ExportButton, { type ExportRow } from "@/components/overview/ExportButton";
import { expiryTone, EXPIRY_CLASS, fmtDate, US_STATES } from "@/lib/hr";
import type { FacilityLicense } from "@/lib/types";

type Fac = { id: string; label: string; state: string | null };
const STATUSES = ["active", "pending", "expired", "revoked"];
const blank = (facilityId = ""): Partial<FacilityLicense> => ({
  facility_id: facilityId,
  licensing_body: "",
  license_state: "",
  license_type: "",
  license_number: "",
  issued_date: "",
  expires_date: "",
  status: "active",
  notes: "",
});

export default function LicensesClient({ facilities }: { facilities: Fac[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<FacilityLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Partial<FacilityLicense> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [facFilter, setFacFilter] = useState("all");

  const facName = useCallback((id: string | null) => facilities.find((f) => f.id === id)?.label || "—", [facilities]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await selectAll<FacilityLicense>((f, t) =>
        supabase.from("facility_licenses").select("*").order("expires_date", { ascending: true }).range(f, t)
      );
      setRows(data);
    } catch {
      setRows([]);
    }
    setLoading(false);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    if (!draft.facility_id) {
      setMsg("Pick a facility.");
      return;
    }
    setBusy(true);
    setMsg("Saving…");
    const payload = {
      facility_id: draft.facility_id,
      licensing_body: draft.licensing_body || null,
      license_state: draft.license_state || null,
      license_type: draft.license_type || null,
      license_number: draft.license_number || null,
      issued_date: draft.issued_date || null,
      expires_date: draft.expires_date || null,
      status: draft.status || "active",
      notes: draft.notes || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = draft.id
      ? await supabase.from("facility_licenses").update(payload).eq("id", draft.id)
      : await supabase.from("facility_licenses").insert(payload);
    setBusy(false);
    if (error) {
      setMsg(`Error: ${error.message}`);
      return;
    }
    setDraft(null);
    setMsg("Saved.");
    load();
    setTimeout(() => setMsg(""), 4000);
  };

  const remove = async (r: FacilityLicense) => {
    if (!confirm(`Delete this ${r.license_type || "license"} for ${facName(r.facility_id)}?`)) return;
    const { error } = await supabase.from("facility_licenses").delete().eq("id", r.id);
    if (error) setMsg(`Error: ${error.message}`);
    else {
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      if (draft?.id === r.id) setDraft(null);
    }
  };

  const visible = useMemo(
    () => (facFilter === "all" ? rows : rows.filter((r) => r.facility_id === facFilter)),
    [rows, facFilter]
  );

  const exportRows: ExportRow[] = visible.map((r) => ({
    Facility: facName(r.facility_id),
    "License Type": r.license_type || "",
    "Licensing Body": r.licensing_body || "",
    State: r.license_state || "",
    "License #": r.license_number || "",
    Issued: r.issued_date || "",
    Expires: r.expires_date || "",
    Status: r.status || "",
    Notes: r.notes || "",
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-xl font-bold text-surface-ink">State Licenses</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select value={facFilter} onChange={(e) => setFacFilter(e.target.value)} className="rounded-lg border border-surface-border bg-surface-card px-2 py-1.5 text-sm">
            <option value="all">All facilities</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <ExportButton rows={exportRows} filename="facility-licenses.xlsx" sheet="Licenses" label="Export to Excel" />
          <button onClick={() => setDraft(blank(facFilter !== "all" ? facFilter : ""))} className="btn-primary px-3 py-1.5 text-sm">
            + Add license
          </button>
        </div>
      </div>

      {draft && (
        <div className="card p-4">
          <div className="mb-2 font-semibold text-surface-ink">{draft.id ? "Edit license" : "New license"}</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Facility">
              <select value={draft.facility_id ?? ""} onChange={(e) => setDraft({ ...draft, facility_id: e.target.value })} className="cell-input w-full">
                <option value="">— select —</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </Field>
            <Field label="License type"><input value={draft.license_type ?? ""} onChange={(e) => setDraft({ ...draft, license_type: e.target.value })} placeholder="e.g. Behavioral Health / SUD" className="cell-input w-full" /></Field>
            <Field label="Licensing body (state agency)"><input value={draft.licensing_body ?? ""} onChange={(e) => setDraft({ ...draft, licensing_body: e.target.value })} placeholder="e.g. NJ DMHAS" className="cell-input w-full" /></Field>
            <Field label="State">
              <select value={draft.license_state ?? ""} onChange={(e) => setDraft({ ...draft, license_state: e.target.value })} className="cell-input w-full">
                <option value="">—</option>
                {US_STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </Field>
            <Field label="License #"><input value={draft.license_number ?? ""} onChange={(e) => setDraft({ ...draft, license_number: e.target.value })} className="cell-input w-full" /></Field>
            <Field label="Status">
              <select value={draft.status ?? "active"} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className="cell-input w-full">
                {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </Field>
            <Field label="Issued date"><input type="date" value={draft.issued_date ?? ""} onChange={(e) => setDraft({ ...draft, issued_date: e.target.value })} className="cell-input w-full" /></Field>
            <Field label="Expiration date"><input type="date" value={draft.expires_date ?? ""} onChange={(e) => setDraft({ ...draft, expires_date: e.target.value })} className="cell-input w-full" /></Field>
            <Field label="Notes"><input value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="cell-input w-full" /></Field>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={save} disabled={busy} className="btn-primary px-4 py-1.5 text-sm">{busy ? "Saving…" : "Save"}</button>
            <button onClick={() => setDraft(null)} className="btn-ghost px-3 py-1.5 text-sm">Cancel</button>
            {msg && <span className="text-xs text-surface-muted">{msg}</span>}
          </div>
        </div>
      )}

      <div className="card p-0">
        {loading ? (
          <p className="p-5 text-sm text-surface-muted">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="p-5 text-sm text-surface-muted">No licenses yet. Click “Add license.”</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr className="text-left text-surface-muted">
                  <th className="px-3 py-2">Facility</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">State · body</th>
                  <th className="px-3 py-2">License #</th>
                  <th className="px-3 py-2">Issued</th>
                  <th className="px-3 py-2">Expires</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-t border-surface-border">
                    <td className="px-3 py-2 font-medium text-surface-ink">{facName(r.facility_id)}</td>
                    <td className="px-3 py-2">{r.license_type || "—"}</td>
                    <td className="px-3 py-2 text-surface-muted">{[r.license_state, r.licensing_body].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.license_number || "—"}</td>
                    <td className="px-3 py-2">{fmtDate(r.issued_date)}</td>
                    <td className={`px-3 py-2 ${EXPIRY_CLASS[expiryTone(r.expires_date)]}`}>{fmtDate(r.expires_date)}</td>
                    <td className="px-3 py-2 text-xs capitalize">{r.status}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setDraft({ ...r })} className="text-xs text-brand-blue hover:underline">Edit</button>
                      <button onClick={() => remove(r)} className="ml-3 text-xs text-risk hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-surface-muted">{label}</span>
      {children}
    </label>
  );
}
