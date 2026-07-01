"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import type { Attachment, Facility } from "@/lib/types";

const BUCKET = "attachments";

const FOLDERS = [
  { key: "medical_records", label: "Medical Records", icon: "▥" },
  { key: "licenses_w9", label: "Licenses & W-9", icon: "❑" },
] as const;
type FolderKey = (typeof FOLDERS)[number]["key"];

function fmtSize(n: number | null): string {
  if (!n || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// A safe, unique object path. Date/random are fine here (client component).
function makePath(folder: FolderKey, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(-80);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${folder}/${stamp}-${safe}`;
}

export default function AttachmentsClient({
  facilities,
  userId,
  isManagement,
}: {
  facilities: Facility[];
  userId: string;
  isManagement: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [folder, setFolder] = useState<FolderKey>("medical_records");
  const [rows, setRows] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [uploadFacility, setUploadFacility] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const facName = useCallback(
    (id: string | null) =>
      facilities.find((f) => f.id === id)?.short_name ||
      facilities.find((f) => f.id === id)?.name ||
      "—",
    [facilities]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await selectAll<Attachment>((f, t) =>
        supabase
          .from("attachments")
          .select("*")
          .order("created_at", { ascending: false })
          .range(f, t)
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

  // Reset the search box when switching folders.
  useEffect(() => setSearch(""), [folder]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.category !== folder) return false;
      if (facilityFilter !== "all" && r.facility_id !== facilityFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, folder, facilityFilter, search]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    setMsg(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`);
    let ok = 0;
    for (const file of files) {
      const path = makePath(folder, file.name);
      const up = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });
      if (up.error) {
        setMsg(`Error uploading ${file.name}: ${up.error.message}`);
        continue;
      }
      const { error } = await supabase.from("attachments").insert({
        category: folder,
        name: file.name,
        path,
        size_bytes: file.size,
        content_type: file.type || null,
        facility_id: uploadFacility || null,
        uploaded_by: userId,
      });
      if (error) {
        // Roll back the orphaned object if the metadata insert fails.
        await supabase.storage.from(BUCKET).remove([path]);
        setMsg(`Error saving ${file.name}: ${error.message}`);
        continue;
      }
      ok++;
    }
    if (fileRef.current) fileRef.current.value = "";
    setBusy(false);
    if (ok) {
      setMsg(`Uploaded ${ok} file${ok > 1 ? "s" : ""}.`);
      setTimeout(() => setMsg(""), 1500);
      load();
    }
  };

  const download = async (r: Attachment) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(r.path, 60, { download: r.name });
    if (error || !data) {
      setMsg(`Error: ${error?.message ?? "could not open file"}`);
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const remove = async (r: Attachment) => {
    if (!confirm(`Delete "${r.name}"? This cannot be undone.`)) return;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    await supabase.storage.from(BUCKET).remove([r.path]);
    const { error } = await supabase.from("attachments").delete().eq("id", r.id);
    setMsg(error ? `Error: ${error.message}` : "Deleted");
    if (!error) setTimeout(() => setMsg(""), 1200);
  };

  const active = FOLDERS.find((f) => f.key === folder)!;

  return (
    <div className="flex h-full flex-col">
      {/* folder tabs */}
      <div className="flex items-center gap-2 border-b border-surface-border bg-surface-card px-6 py-3">
        {FOLDERS.map((f) => {
          const count = rows.filter((r) => r.category === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setFolder(f.key)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
                folder === f.key
                  ? "bg-command text-command-text"
                  : "text-surface-muted hover:bg-surface"
              }`}
            >
              <span>{f.icon}</span>
              {f.label}
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  folder === f.key ? "bg-command-text/20" : "bg-surface"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* toolbar: search + facility filter + upload */}
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface px-6 py-3">
        <input
          placeholder={`Search ${active.label}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-[20rem] flex-1"
        />
        <select
          value={facilityFilter}
          onChange={(e) => setFacilityFilter(e.target.value)}
          className="input max-w-[14rem]"
        >
          <option value="all">All facilities</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.short_name || f.name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-3">
          {msg && <span className="text-xs font-medium text-secured">{msg}</span>}
          <span className="text-xs text-surface-muted">
            <b className="text-surface-ink">{filtered.length}</b> file
            {filtered.length === 1 ? "" : "s"}
          </span>
          <select
            value={uploadFacility}
            onChange={(e) => setUploadFacility(e.target.value)}
            className="input max-w-[12rem] text-xs"
            title="Tag uploads with a facility (optional)"
          >
            <option value="">No facility tag</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.short_name || f.name}
              </option>
            ))}
          </select>
          <input
            ref={fileRef}
            type="file"
            multiple
            onChange={onUpload}
            className="hidden"
            id="attach-file"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="btn-gold disabled:opacity-50"
          >
            {busy ? "Uploading…" : `↥ Upload to ${active.label}`}
          </button>
        </div>
      </div>

      {/* file list */}
      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th">Name</th>
              <th className="th">Facility</th>
              <th className="th text-right">Size</th>
              <th className="th">Uploaded</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="td py-10 text-center text-surface-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="td py-10 text-center text-surface-muted">
                  {search
                    ? "No files match your search."
                    : `No files in ${active.label} yet. Use “Upload” to add some.`}
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((r, i) => (
                <tr key={r.id} className={i % 2 ? "bg-surface/40" : "bg-surface-card"}>
                  <td className="td font-medium">
                    <button onClick={() => download(r)} className="text-command hover:underline">
                      {r.name}
                    </button>
                  </td>
                  <td className="td text-xs text-surface-muted">{facName(r.facility_id)}</td>
                  <td className="td text-right font-mono text-xs">{fmtSize(r.size_bytes)}</td>
                  <td className="td text-xs text-surface-muted">
                    {(r.created_at || "").slice(0, 10)}
                  </td>
                  <td className="td whitespace-nowrap text-right">
                    <button
                      onClick={() => download(r)}
                      className="mr-2 rounded-md border border-surface-border px-2 py-1 text-xs font-semibold text-surface-muted hover:bg-surface"
                    >
                      Download
                    </button>
                    {isManagement && (
                      <button
                        onClick={() => remove(r)}
                        className="rounded-md border border-surface-border px-2 py-1 text-xs font-semibold text-risk hover:bg-risk/10"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
