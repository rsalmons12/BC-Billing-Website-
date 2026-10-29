"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import ExportButton, { type ExportRow } from "@/components/overview/ExportButton";
import { expiryTone, EXPIRY_CLASS, fmtDate, US_STATES } from "@/lib/hr";
import type { StaffMember } from "@/lib/types";

type Fac = { id: string; label: string };
const STATUSES = ["active", "inactive", "terminated"];
const blank = (facilityId = ""): Partial<StaffMember> => ({
  facility_id: facilityId || null,
  full_name: "",
  title: "",
  email: "",
  phone: "",
  hire_date: "",
  status: "active",
  credential_type: "",
  credential_number: "",
  credential_state: "",
  credential_expires: "",
  notes: "",
});

export default function StaffClient({ facilities }: { facilities: Fac[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Partial<StaffMember> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [facFilter, setFacFilter] = useState("all");

  const facName = useCallback(
    (id: string | null) => (id ? facilities.find((f) => f.id === id)?.label || "—" : "Org-wide"),
    [facilities]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await selectAll<StaffMember>((f, t) =>
        supabase.from("staff_members").select("*").order("full_name", { ascending: true }).range(f, t)
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
    if (!draft.full_name?.trim()) {
      setMsg("Name is required.");
      return;
    }
    setBusy(true);
    setMsg("Saving…");
    const payload = {
      facility_id: draft.facility_id || null,
      full_name: draft.full_name.trim(),
      title: draft.title || null,
      email: draft.email || null,
      phone: draft.phone || null,
      hire_date: draft.hire_date || null,
      status: draft.status || "active",
      credential_type: draft.credential_type || null,
      credential_number: draft.credential_number || null,
      credential_state: draft.credential_state || null,
      credential_expires: draft.credential_expires || null,
      notes: draft.notes || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = draft.id
      ? await supabase.from("staff_members").update(payload).eq("id", draft.id)
      : await supabase.from("staff_members").insert(payload);
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

  const remove = async (r: StaffMember) => {
    if (!confirm(`Delete ${r.full_name}?`)) return;
    const { error } = await supabase.from("staff_members").delete().eq("id", r.id);
    if (error) setMsg(`Error: ${error.message}`);
    else {
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      if (draft?.id === r.id) setDraft(null);
    }
  };

  const visible = useMemo(
    () => (facFilter === "all" ? rows : rows.filter((r) => (facFilter === "org" ? !r.facility_id : r.facility_id === facFilter))),
    [rows, facFilter]
  );

  const exportRows: ExportRow[] = visible.map((r) => ({
    Name: r.full_name,
    Title: r.title || "",
    Facility: facName(r.facility_id),
    Email: r.email || "",
    Phone: r.phone || "",
    Hired: r.hire_date || "",
    Status: r.status || "",
    Credential: r.credential_type || "",
    "Credential #": r.credential_number || "",
    "Cred. State": r.credential_state || "",
    "Cred. Expires": r.credential_expires || "",
    Notes: r.notes || "",
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-xl font-bold text-surface-ink">Staff / HR Records</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select value={facFilter} onChange={(e) => setFacFilter(e.target.value)} className="rounded-lg border border-surface-border bg-surface-card px-2 py-1.5 text-sm">
            <option value="all">All</option>
            <option value="org">Org-wide</option>
            {facilities.map((f) => (<option key={f.id} value={f.id}>{f.label}</option>))}
          </select>
          <ExportButton rows={exportRows} filename="staff-hr.xlsx" sheet="Staff" label="Export to Excel" />
          <button onClick={() => setDraft(blank(facFilter !== "all" && facFilter !== "org" ? facFilter : ""))} className="btn-primary px-3 py-1.5 text-sm">+ Add staff</button>
        </div>
      </div>

      {draft && (
        <div className="card p-4">
          <div className="mb-2 font-semibold text-surface-ink">{draft.id ? "Edit staff member" : "New staff member"}</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Full name"><input value={draft.full_name ?? ""} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} className="cell-input w-full" /></Field>
            <Field label="Title / position"><input value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="cell-input w-full" /></Field>
            <Field label="Facility">
              <select value={draft.facility_id ?? ""} onChange={(e) => setDraft({ ...draft, facility_id: e.target.value || null })} className="cell-input w-full">
                <option value="">Org-wide (no facility)</option>
                {facilities.map((f) => (<option key={f.id} value={f.id}>{f.label}</option>))}
              </select>
            </Field>
            <Field label="Email"><input value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="cell-input w-full" /></Field>
            <Field label="Phone"><input value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="cell-input w-full" /></Field>
            <Field label="Status">
              <select value={draft.status ?? "active"} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className="cell-input w-full">
                {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </Field>
            <Field label="Hire date"><input type="date" value={draft.hire_date ?? ""} onChange={(e) => setDraft({ ...draft, hire_date: e.target.value })} className="cell-input w-full" /></Field>
            <Field label="Credential type"><input value={draft.credential_type ?? ""} onChange={(e) => setDraft({ ...draft, credential_type: e.target.value })} placeholder="e.g. LCSW, RN, CADC" className="cell-input w-full" /></Field>
            <Field label="Credential #"><input value={draft.credential_number ?? ""} onChange={(e) => setDraft({ ...draft, credential_number: e.target.value })} className="cell-input w-full" /></Field>
            <Field label="Credential state">
              <select value={draft.credential_state ?? ""} onChange={(e) => setDraft({ ...draft, credential_state: e.target.value })} className="cell-input w-full">
                <option value="">—</option>
                {US_STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </Field>
            <Field label="Credential expires"><input type="date" value={draft.credential_expires ?? ""} onChange={(e) => setDraft({ ...draft, credential_expires: e.target.value })} className="cell-input w-full" /></Field>
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
          <p className="p-5 text-sm text-surface-muted">No staff records yet. Click “Add staff.”</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr className="text-left text-surface-muted">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Facility</th>
                  <th className="px-3 py-2">Credential</th>
                  <th className="px-3 py-2">Cred. expires</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-t border-surface-border">
                    <td className="px-3 py-2 font-medium text-surface-ink">{r.full_name}</td>
                    <td className="px-3 py-2 text-surface-muted">{r.title || "—"}</td>
                    <td className="px-3 py-2 text-surface-muted">{facName(r.facility_id)}</td>
                    <td className="px-3 py-2">{[r.credential_type, r.credential_state].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={`px-3 py-2 ${EXPIRY_CLASS[expiryTone(r.credential_expires)]}`}>{fmtDate(r.credential_expires)}</td>
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
