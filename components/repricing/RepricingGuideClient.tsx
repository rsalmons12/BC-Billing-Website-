"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Two reserved rows in payer_playbooks (never shown as payer bubbles): a pinned
// "General Approach" statement at the top, and the editable process/vendor notes
// (with example/template files) below it.
const KEY_APPROACH = "__general_approach__";
const KEY_PROCESS = "__general_repricing__";
const BUCKET = "attachments";

type Attach = { name: string; path: string; size?: number; type?: string };

const DEFAULT_APPROACH = `REPRICING — GENERAL APPROACH

Policies are priced through many different third parties (Data iSight, Zelis,
GCS, and others). The key to being the best at repricing is understanding your
policies and carriers:
   • Know what goes where — which carrier / policy routes to which pricer.
   • Know how and when to reject their offers.
   • Know when sending a claim back will pay higher.

Example: Cigna MRC-2 policies pay well, but MRC-1 does not. This kind of detail
is on the patient's VOB. If it isn't there, request a new VOB specifying exactly
what you're looking for: vob@bcbillingsolution.com`;

const DEFAULT_PROCESS = `DATA ISIGHT — REPRICING PROCESS

Data iSight prices claims for several payers (Cigna, UnitedHealthcare, BCBS,
and others). Send them everything — they determine which claims belong to them
and reprice those. Not every claim is worth running through Data iSight, but
sending all of them lets Data iSight sort out what they own.

HOW TO SUBMIT
1. Download all repricing-eligible claims across payers (UHC, Cigna, BCBS, etc.).
2. Put them on the spreadsheet and email it to Data iSight:
      discustomerservice@dataisight.com
3. Data iSight returns the claims and prices through their portal.
4. Go through the portal results:
      • Priced correctly  → sign / accept and return those.
      • Not priced right   → call that payer directly and ask to have the
                             pricing reviewed.`;

export default function RepricingGuideClient({
  canEdit,
  userId,
}: {
  canEdit: boolean;
  userId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [approach, setApproach] = useState("");
  const [process, setProcess] = useState("");
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("payer_playbooks")
        .select("payer, instructions, attachments")
        .in("payer", [KEY_APPROACH, KEY_PROCESS]);
      if (!alive) return;
      const rows = (data ?? []) as { payer: string; instructions: string; attachments: unknown }[];
      const a = rows.find((r) => r.payer === KEY_APPROACH);
      const p = rows.find((r) => r.payer === KEY_PROCESS);
      setApproach(a?.instructions ?? "");
      setProcess(p?.instructions ?? "");
      setAttachments(Array.isArray(p?.attachments) ? (p!.attachments as Attach[]) : []);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  const saveNote = async (key: string, value: string) => {
    if (key === KEY_APPROACH) setApproach(value);
    else setProcess(value);
    await supabase.from("payer_playbooks").upsert(
      { payer: key, instructions: value, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "payer" }
    );
  };

  const setAtt = async (next: Attach[]) => {
    setAttachments(next);
    await supabase.from("payer_playbooks").upsert(
      { payer: KEY_PROCESS, attachments: next, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "payer" }
    );
  };
  const upload = async (file: File): Promise<string> => {
    const path = `payer-playbooks/general/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
    });
    if (error) return error.message;
    await setAtt([...attachments, { name: file.name, path, size: file.size, type: file.type }]);
    return "";
  };
  const removeAtt = async (path: string) => {
    await supabase.storage.from(BUCKET).remove([path]);
    await setAtt(attachments.filter((a) => a.path !== path));
  };
  const download = async (path: string) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  if (!loaded) {
    return <div className="mx-auto max-w-3xl p-6 text-surface-muted">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      {/* Pinned general approach — always at the top, its own section */}
      <NoteSection
        title="General Approach"
        accent
        text={approach}
        defaultText={DEFAULT_APPROACH}
        canEdit={canEdit}
        onSave={(v) => saveNote(KEY_APPROACH, v)}
      />

      {/* Process & vendor notes + files */}
      <NoteSection
        title="Process & Vendor Notes"
        subtitle="Data iSight, Zelis, GCS…"
        text={process}
        defaultText={DEFAULT_PROCESS}
        canEdit={canEdit}
        onSave={(v) => saveNote(KEY_PROCESS, v)}
        attachments={attachments}
        onUpload={upload}
        onRemove={removeAtt}
        onDownload={download}
      />
    </div>
  );
}

function NoteSection({
  title,
  subtitle,
  accent = false,
  text,
  defaultText,
  canEdit,
  onSave,
  attachments,
  onUpload,
  onRemove,
  onDownload,
}: {
  title: string;
  subtitle?: string;
  accent?: boolean;
  text: string;
  defaultText: string;
  canEdit: boolean;
  onSave: (v: string) => void | Promise<void>;
  attachments?: Attach[];
  onUpload?: (file: File) => Promise<string>;
  onRemove?: (path: string) => void;
  onDownload?: (path: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saveState, setSaveState] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const body = text.trim() ? text : defaultText;

  const start = () => {
    setDraft(text.trim() ? text : defaultText);
    setEditing(true);
  };
  const save = async () => {
    setSaveState("Saving…");
    try {
      await onSave(draft);
      setSaveState("Saved");
      setEditing(false);
      setTimeout(() => setSaveState(""), 1200);
    } catch (e) {
      setSaveState(`Error: ${e instanceof Error ? e.message : "save failed"}`);
    }
  };

  return (
    <section
      className={`card p-5 ${accent ? "border-l-4 border-l-brand-blue" : ""}`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-surface-ink">{title}</h2>
          {subtitle && <p className="text-xs text-surface-muted">{subtitle}</p>}
        </div>
        {canEdit && !editing && (
          <button className="btn-ghost shrink-0" onClick={start}>
            ✎ Edit
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={16}
            autoFocus
            className="cell-input w-full resize-y whitespace-pre-wrap leading-relaxed"
          />
          <div className="mt-3 flex items-center gap-2">
            <button className="btn-primary" onClick={save}>
              Save
            </button>
            <button className="btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {saveState && <span className="text-xs font-medium text-secured">{saveState}</span>}
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-surface-ink">{body}</div>
      )}

      {/* Attachments (process section only) */}
      {attachments && onUpload && onDownload && (attachments.length > 0 || canEdit) && (
        <div className="mt-4 border-t border-surface-border pt-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
            Example &amp; template files
          </div>
          {attachments.length === 0 && <div className="text-xs text-surface-muted">None yet.</div>}
          <ul className="space-y-1">
            {attachments.map((a) => (
              <li
                key={a.path}
                className="flex items-center justify-between gap-2 rounded-md border border-surface-border bg-surface px-2.5 py-1.5 text-sm"
              >
                <button
                  onClick={() => onDownload(a.path)}
                  className="min-w-0 flex-1 truncate text-left text-brand-blue hover:underline"
                  title={a.name}
                >
                  📎 {a.name}
                </button>
                {canEdit && onRemove && (
                  <button
                    onClick={() => onRemove(a.path)}
                    className="shrink-0 text-xs font-semibold text-risk hover:underline"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setSaveState("Uploading…");
                    const err = await onUpload(f);
                    setSaveState(err ? `Error: ${err}` : "Uploaded");
                    setTimeout(() => setSaveState(""), 1200);
                  }
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <button onClick={() => fileRef.current?.click()} className="btn-ghost mt-2 text-sm">
                ＋ Add example / template file
              </button>
              {saveState && <span className="ml-2 text-xs font-medium text-secured">{saveState}</span>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
