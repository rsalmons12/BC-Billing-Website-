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

// Split a notes field into its dated entries so each shows in its own box.
// Each line is "MM/DD/YY (INIT): text"; anything unrecognized shows as-is.
function parseNoteEntries(value: string): { head: string; text: string }[] {
  return String(value ?? "")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim())
    .map((line) => {
      const m = line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})\s*\(([^)]*)\):\s*([\s\S]*)$/);
      return m ? { head: `${m[1]} · ${m[2]}`, text: m[3] } : { head: "", text: line };
    });
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

  const entries = parseNoteEntries(value);

  return (
    <div className="space-y-2">
      {entries.length > 0 && (
        <div className="max-h-48 space-y-1.5 overflow-auto">
          {entries.map((e, i) => (
            <div
              key={i}
              className="rounded-md border border-surface-border bg-surface-card px-2 py-1 text-xs leading-snug text-surface-ink"
            >
              {e.head && (
                <div className="mb-0.5 font-semibold text-surface-muted">{e.head}</div>
              )}
              <div className="whitespace-pre-wrap break-words">{e.text}</div>
            </div>
          ))}
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
