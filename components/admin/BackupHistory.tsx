"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface BackupFile {
  name: string;
  created_at: string;
}

export default function BackupHistory() {
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data, error } = await supabase.storage.from("backups").list("", {
        limit: 30,
        sortBy: { column: "created_at", order: "desc" },
      });
      if (!error && data) {
        setFiles(
          data
            .filter((f) => f.name.endsWith(".xlsx"))
            .map((f) => ({ name: f.name, created_at: f.created_at ?? "" }))
        );
      }
      setLoading(false);
    };
    load();
  }, []);

  const download = async (name: string) => {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("backups")
      .download(name);
    if (error || !data) return;
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <p className="text-sm text-surface-muted">Loading backups…</p>;
  if (files.length === 0)
    return <p className="text-sm text-surface-muted">No automatic backups yet.</p>;

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface">
          <tr>
            <th className="th">Date</th>
            <th className="th">File</th>
            <th className="th"></th>
          </tr>
        </thead>
        <tbody>
          {files.map((f, idx) => (
            <tr key={f.name} className={idx % 2 ? "bg-surface/40" : ""}>
              <td className="td text-surface-muted">
                {f.created_at
                  ? new Date(f.created_at).toLocaleDateString()
                  : "—"}
              </td>
              <td className="td font-mono text-xs">{f.name}</td>
              <td className="td text-right">
                <button
                  onClick={() => download(f.name)}
                  className="text-xs font-semibold text-brand-blue hover:underline"
                >
                  ↓ Download
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
