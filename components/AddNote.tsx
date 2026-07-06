"use client";

import { useEffect, useState } from "react";

// Today's date as MM/DD/YY. New notes are ALWAYS stamped with the current date
// (never a past date) — the stamp is generated here, not entered by the user.
function todayStamp(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
}

// A note entry box that REQUIRES initials and stamps today's date. The note
// can't be added without both text and initials. New entries are prepended to
// the existing note history (which shows above, read-only).
export default function AddNote({
  value,
  defaultInitials = "",
  onSave,
  placeholder = "Add a note…",
}: {
  value: string;
  defaultInitials?: string;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [initials, setInitials] = useState(defaultInitials);
  useEffect(() => setInitials(defaultInitials), [defaultInitials]);

  const canSave = text.trim().length > 0 && initials.trim().length > 0;

  const add = () => {
    if (!canSave) {
      alert("A note needs your initials and text — it can't be saved without both.");
      return;
    }
    const entry = `${todayStamp()} (${initials.trim().toUpperCase()}): ${text.trim()}`;
    onSave(value && value.trim() ? `${entry}\n${value}` : entry);
    setText("");
  };

  return (
    <div className="space-y-2">
      {value && value.trim() && (
        <div className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-surface-border bg-surface-card p-2 text-xs leading-snug text-surface-ink">
          {value}
        </div>
      )}
      <div className="flex items-start gap-2">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="cell-input min-h-[2.5rem] flex-1 resize-y leading-snug"
        />
        <input
          value={initials}
          onChange={(e) => setInitials(e.target.value)}
          placeholder="INIT *"
          title="Your initials (required)"
          className={`cell-input w-16 uppercase ${
            !initials.trim() ? "ring-1 ring-risk/40" : ""
          }`}
        />
        <button
          onClick={add}
          disabled={!canSave}
          className="btn-primary whitespace-nowrap px-3 py-1.5 text-xs disabled:opacity-50"
          title={canSave ? "Add note (auto-dated today)" : "Enter note text and your initials"}
        >
          + Add
        </button>
      </div>
      <p className="text-[10px] text-surface-muted">
        Stamped with today&apos;s date ({todayStamp()}) and your initials.
      </p>
    </div>
  );
}
