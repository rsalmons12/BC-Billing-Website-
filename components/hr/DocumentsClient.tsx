"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { expiryTone, EXPIRY_CLASS, fmtDate } from "@/lib/hr";
import type { ComplianceDocument } from "@/lib/types";

type Fac = { id: string; label: string };
const BUCKET = "attachments";
const CATEGORIES = ["policy", "audit", "incident", "license", "training", "other"];

function fmtSize(n: number | null): string {
  if (!n || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function objectPath(facilityId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(-80);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `compliance/${facilityId || "org"}/${stamp}-${safe}`;
}

export default function DocumentsClient({ facilities, userId }: { facilities: Fac[]; userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<ComplianceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [facFilter, setFacFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const fileRef = useRef<HTMLInputElement>(null);

  // Upload form fields.
  const [uFac, setUFac] = useState("");
  const [uCat, setUCat] = useState("policy");
  const [uTitle, setUTitle] = useState("");
  const [uDocDate, setUDocDate] = useState("");
  const [uExpires, setUExpires] = useState("");
  const [uNotes, setUNotes] = useState("");

  const facName = useCallback(
    (id: string | null) => (id ? facilities.find((f) => f.id === id)?.label || "—" : "Org-wide"),
    [facilities]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await selectAll<ComplianceDocument>((f, t) =>
        supabase.from("compliance_documents").select("*").order("created_at", { ascending: false }).range(f, t)
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

  const upload = async () => {
    const file = fileRef.current?.files?.[0] ?? null;
    if (!uTitle.trim()) {
      setMsg("Give the document a title.");
      return;
    }
    setBusy(true);
    setMsg(file ? "Uploading…" : "Saving…");
    let path: string | null = null;
    let contentType: string | null = null;
    let size: number | null = null;
    if (file) {
      path = objectPath(uFac, file.name);
      contentType = file.type || null;
      size = file.size;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
      if (up.error) {
        setBusy(false);
        setMsg(`Upload error: ${up.error.message}`);
        return;
      }
    }
    const { error } = await supabase.from("compliance_documents").insert({
      facility_id: uFac || null,
      category: uCat,
      title: uTitle.trim(),
      path,
      content_type: contentType,
      size_bytes: size,
      doc_date: uDocDate || null,
      expires_date: uExpires || null,
      notes: uNotes || null,
      uploaded_by: userId,
    });
    setBusy(false);
    if (error) {
      if (path) await supabase.storage.from(BUCKET).remove([path]);
      setMsg(`Error: ${error.message}`);
      return;
    }
    setUTitle("");
    setUDocDate("");
    setUExpires("");
    setUNotes("");
    if (fileRef.current) fileRef.current.value = "";
    setMsg("Saved.");
    load();
    setTimeout(() => setMsg(""), 4000);
  };

  const download = async (r: ComplianceDocument) => {
    if (!r.path) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(r.path, 300);
    if (error || !data?.signedUrl) {
      setMsg(`Could not open file: ${error?.message ?? "no URL"}`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noreferrer");
  };

  const remove = async (r: ComplianceDocument) => {
    if (!confirm(`Delete "${r.title}"?`)) return;
    const { error } = await supabase.from("compliance_documents").delete().eq("id", r.id);
    if (error) {
      setMsg(`Error: ${error.message}`);
      return;
    }
    if (r.path) await supabase.storage.from(BUCKET).remove([r.path]);
    setRows((prev) => prev.filter((x) => x.id !== r.id));
  };

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (facFilter === "all" || (facFilter === "org" ? !r.facility_id : r.facility_id === facFilter)) &&
          (catFilter === "all" || r.category === catFilter)
      ),
    [rows, facFilter, catFilter]
  );

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold text-surface-ink">Compliance Documents</h1>

      <div className="card p-4">
        <div className="mb-2 font-semibold text-surface-ink">Upload a document</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Title"><input value={uTitle} onChange={(e) => setUTitle(e.target.value)} placeholder="e.g. Annual Fire Inspection" className="cell-input w-full" /></Field>
          <Field label="Category">
            <select value={uCat} onChange={(e) => setUCat(e.target.value)} className="cell-input w-full capitalize">
              {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </Field>
          <Field label="Facility">
            <select value={uFac} onChange={(e) => setUFac(e.target.value)} className="cell-input w-full">
              <option value="">Org-wide (no facility)</option>
              {facilities.map((f) => (<option key={f.id} value={f.id}>{f.label}</option>))}
            </select>
          </Field>
          <Field label="Document date"><input type="date" value={uDocDate} onChange={(e) => setUDocDate(e.target.value)} className="cell-input w-full" /></Field>
          <Field label="Expires (optional)"><input type="date" value={uExpires} onChange={(e) => setUExpires(e.target.value)} className="cell-input w-full" /></Field>
          <Field label="File"><input ref={fileRef} type="file" className="w-full text-sm" /></Field>
          <Field label="Notes"><input value={uNotes} onChange={(e) => setUNotes(e.target.value)} className="cell-input w-full" /></Field>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={upload} disabled={busy} className="btn-primary px-4 py-1.5 text-sm">{busy ? "Working…" : "Save document"}</button>
          {msg && <span className="text-xs text-surface-muted">{msg}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={facFilter} onChange={(e) => setFacFilter(e.target.value)} className="rounded-lg border border-surface-border bg-surface-card px-2 py-1.5 text-sm">
          <option value="all">All facilities</option>
          <option value="org">Org-wide</option>
          {facilities.map((f) => (<option key={f.id} value={f.id}>{f.label}</option>))}
        </select>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-lg border border-surface-border bg-surface-card px-2 py-1.5 text-sm capitalize">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </div>

      <div className="card p-0">
        {loading ? (
          <p className="p-5 text-sm text-surface-muted">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="p-5 text-sm text-surface-muted">No documents yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr className="text-left text-surface-muted">
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Facility</th>
                  <th className="px-3 py-2">Doc date</th>
                  <th className="px-3 py-2">Expires</th>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-t border-surface-border">
                    <td className="px-3 py-2 font-medium text-surface-ink">{r.title}{r.notes ? <span className="block text-xs text-surface-muted">{r.notes}</span> : null}</td>
                    <td className="px-3 py-2 text-xs capitalize">{r.category}</td>
                    <td className="px-3 py-2 text-surface-muted">{facName(r.facility_id)}</td>
                    <td className="px-3 py-2">{fmtDate(r.doc_date)}</td>
                    <td className={`px-3 py-2 ${EXPIRY_CLASS[expiryTone(r.expires_date)]}`}>{fmtDate(r.expires_date)}</td>
                    <td className="px-3 py-2 text-xs text-surface-muted">{fmtSize(r.size_bytes)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.path && (
                        <button onClick={() => download(r)} className="text-xs text-brand-blue hover:underline">Download</button>
                      )}
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
