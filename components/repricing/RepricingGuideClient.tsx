"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Stored as a reserved row in payer_playbooks (never shown as a payer bubble).
const GENERAL_KEY = "__general_repricing__";
const BUCKET = "attachments";

type Attach = { name: string; path: string; size?: number; type?: string };

const DEFAULT_GUIDE = `REPRICING — GENERAL APPROACH

Policies are priced through many different third parties (Data iSight, Zelis,
GCS, and others). The key to being the best at repricing is understanding your
policies and carriers:
   • Know what goes where — which carrier / policy routes to which pricer.
   • Know how and when to reject their offers.
   • Know when sending a claim back will pay higher.

Example: Cigna MRC-2 policies pay well, but MRC-1 does not. This kind of detail
is on the patient's VOB. If it isn't there, request a new VOB specifying exactly
what you're looking for: vob@bcbillingsolution.com


DATA ISIGHT — REPRICING PROCESS

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
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("payer_playbooks")
        .select("instructions, attachments")
        .eq("payer", GENERAL_KEY)
        .maybeSingle();
      if (!alive) return;
      setText(data?.instructions ?? "");
      setAttachments(Array.isArray(data?.attachments) ? (data!.attachments as Attach[]) : []);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  const body = text.trim() ? text : DEFAULT_GUIDE;

  const startEdit = () => {
    setDraft(text.trim() ? text : DEFAULT_GUIDE);
    setEditing(true);
  };

  const saveText = async () => {
    setSaveState("Saving…");
    setText(draft);
    const { error } = await supabase.from("payer_playbooks").upsert(
      { payer: GENERAL_KEY, instructions: draft, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "payer" }
    );
    setSaveState(error ? `Error: ${error.message}` : "Saved");
    if (!error) {
      setEditing(false);
      setTimeout(() => setSaveState(""), 1200);
    }
  };

  const upload = async (file: File) => {
    setSaveState("Uploading…");
    const path = `payer-playbooks/general/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
    });
    if (error) {
      setSaveState(`Error: ${error.message}`);
      return;
    }
    const next = [...attachments, { name: file.name, path, size: file.size, type: file.type }];
    setAttachments(next);
    const { error: dbErr } = await supabase.from("payer_playbooks").upsert(
      { payer: GENERAL_KEY, attachments: next, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "payer" }
    );
    setSaveState(dbErr ? `Error: ${dbErr.message}` : "Uploaded");
    if (!dbErr) setTimeout(() => setSaveState(""), 1200);
  };

  const remove = async (path: string) => {
    const next = attachments.filter((a) => a.path !== path);
    setAttachments(next);
    await supabase.storage.from(BUCKET).remove([path]);
    await supabase.from("payer_playbooks").upsert(
      { payer: GENERAL_KEY, attachments: next, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "payer" }
    );
  };

  const download = async (path: string) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-surface-ink">Repricing Guide</h1>
          <p className="text-xs text-surface-muted">
            General repricing process &amp; vendor notes (Data iSight, Zelis, GCS…).
          </p>
        </div>
        {canEdit && !editing && (
          <button className="btn-ghost" onClick={startEdit}>
            ✎ Edit
          </button>
        )}
      </div>

      {!loaded ? (
        <div className="text-surface-muted">Loading…</div>
      ) : editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={20}
            autoFocus
            className="cell-input w-full resize-y whitespace-pre-wrap leading-relaxed"
          />
          <div className="mt-3 flex items-center gap-2">
            <button className="btn-primary" onClick={saveText}>
              Save
            </button>
            <button className="btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {saveState && <span className="text-xs font-medium text-secured">{saveState}</span>}
          </div>
        </div>
      ) : (
        <div className="card whitespace-pre-wrap p-5 text-sm leading-relaxed text-surface-ink">
          {body}
        </div>
      )}

      {/* Example / template files */}
      {loaded && (attachments.length > 0 || canEdit) && (
        <div className="mt-5">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
            Example &amp; template files
          </div>
          {attachments.length === 0 && (
            <div className="text-xs text-surface-muted">None yet.</div>
          )}
          <ul className="space-y-1">
            {attachments.map((a) => (
              <li
                key={a.path}
                className="flex items-center justify-between gap-2 rounded-md border border-surface-border bg-surface px-2.5 py-1.5 text-sm"
              >
                <button
                  onClick={() => download(a.path)}
                  className="min-w-0 flex-1 truncate text-left text-brand-blue hover:underline"
                  title={a.name}
                >
                  📎 {a.name}
                </button>
                {canEdit && (
                  <button
                    onClick={() => remove(a.path)}
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
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <button onClick={() => fileRef.current?.click()} className="btn-ghost mt-2 text-sm">
                ＋ Add example / template file
              </button>
              {saveState && !editing && (
                <span className="ml-2 text-xs font-medium text-secured">{saveState}</span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
