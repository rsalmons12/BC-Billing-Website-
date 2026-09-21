"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Stored as a reserved row in payer_playbooks (never shown as a payer bubble).
const GENERAL_KEY = "__general_repricing__";

const DEFAULT_GUIDE = `DATA ISIGHT — REPRICING PROCESS

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
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("payer_playbooks")
        .select("instructions")
        .eq("payer", GENERAL_KEY)
        .maybeSingle();
      if (!alive) return;
      setText(data?.instructions ?? "");
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

  const save = async () => {
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
        <div className="card whitespace-pre-wrap p-5 text-sm leading-relaxed text-surface-ink">
          {body}
        </div>
      )}
    </div>
  );
}
