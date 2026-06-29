"use client";

import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TABS } from "@/lib/nav";
import type { Profile, Facility, Assignment, Role } from "@/lib/types";

type Tab = "users" | "facilities" | "create";

const ROLES: Role[] = ["management", "staff", "facility", "pending"];

export default function AdminClient({
  initialProfiles,
  initialFacilities,
  initialAssignments,
  selfId,
}: {
  initialProfiles: Profile[];
  initialFacilities: Facility[];
  initialAssignments: Assignment[];
  selfId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("users");
  const [profiles, setProfiles] = useState(initialProfiles);
  const [facilities, setFacilities] = useState(initialFacilities);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [msg, setMsg] = useState("");

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 2000);
  };

  const reloadProfiles = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").order("created_at");
    setProfiles((data as Profile[]) ?? []);
  }, [supabase]);

  // ---- profile mutations ----
  const setRole = async (p: Profile, role: Role) => {
    setProfiles((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, role } : x))
    );
    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", p.id);
    flash(error ? `Error: ${error.message}` : "Role updated");
  };

  const setFacilityId = async (p: Profile, facility_id: string | null) => {
    setProfiles((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, facility_id } : x))
    );
    const { error } = await supabase
      .from("profiles")
      .update({ facility_id })
      .eq("id", p.id);
    flash(error ? `Error: ${error.message}` : "Facility set");
  };

  // ---- assignment chip toggle ----
  const toggleAssignment = async (p: Profile, facilityId: string) => {
    const existing = assignments.find(
      (a) => a.profile_id === p.id && a.facility_id === facilityId
    );
    if (existing) {
      setAssignments((prev) => prev.filter((a) => a.id !== existing.id));
      const { error } = await supabase
        .from("assignments")
        .delete()
        .eq("id", existing.id);
      if (error) flash(`Error: ${error.message}`);
    } else {
      const { data, error } = await supabase
        .from("assignments")
        .insert({ profile_id: p.id, facility_id: facilityId })
        .select()
        .single();
      if (error) {
        flash(`Error: ${error.message}`);
      } else if (data) {
        setAssignments((prev) => [...prev, data as Assignment]);
      }
    }
  };

  // ---- per-user tab visibility ----
  const setAllowedTabs = async (p: Profile, tabs: string[] | null) => {
    setProfiles((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, allowed_tabs: tabs } : x))
    );
    const { error } = await supabase
      .from("profiles")
      .update({ allowed_tabs: tabs })
      .eq("id", p.id);
    flash(error ? `Error: ${error.message}` : "Tabs updated");
  };

  const toggleTab = async (p: Profile, href: string) => {
    const roleTabs = TABS.filter((t) => t.roles.includes(p.role)).map((t) => t.href);
    const current = p.allowed_tabs ?? roleTabs;
    const next = current.includes(href)
      ? current.filter((h) => h !== href)
      : [...current, href];
    // If they can see everything their role allows, store null (the default).
    const isAll = roleTabs.every((h) => next.includes(h)) && next.length === roleTabs.length;
    setAllowedTabs(p, isAll ? null : next);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-2">
        {(
          [
            ["users", "Users"],
            ["facilities", "Facilities"],
            ["create", "Create User"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === key
                ? "bg-command text-command-text"
                : "border border-surface-border bg-surface-card text-surface-muted hover:bg-surface"
            }`}
          >
            {label}
          </button>
        ))}
        {msg && (
          <span className="ml-auto text-sm font-medium text-secured">{msg}</span>
        )}
      </div>

      {tab === "users" && (
        <UsersTab
          profiles={profiles}
          facilities={facilities}
          assignments={assignments}
          selfId={selfId}
          setRole={setRole}
          setFacilityId={setFacilityId}
          toggleAssignment={toggleAssignment}
          toggleTab={toggleTab}
        />
      )}

      {tab === "facilities" && (
        <FacilitiesTab
          facilities={facilities}
          setFacilities={setFacilities}
          flash={flash}
        />
      )}

      {tab === "create" && (
        <CreateUserTab onCreated={reloadProfiles} flash={flash} />
      )}
    </div>
  );
}

function UsersTab({
  profiles,
  facilities,
  assignments,
  selfId,
  setRole,
  setFacilityId,
  toggleAssignment,
  toggleTab,
}: {
  profiles: Profile[];
  facilities: Facility[];
  assignments: Assignment[];
  selfId: string;
  setRole: (p: Profile, r: Role) => void;
  setFacilityId: (p: Profile, id: string | null) => void;
  toggleAssignment: (p: Profile, facilityId: string) => void;
  toggleTab: (p: Profile, href: string) => void;
}) {
  return (
    <div className="space-y-3">
      {profiles.map((p) => {
        const assigned = new Set(
          assignments.filter((a) => a.profile_id === p.id).map((a) => a.facility_id)
        );
        return (
          <div key={p.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-[12rem]">
                <div className="font-semibold">
                  {p.full_name || "Unnamed user"}
                  {p.id === selfId && (
                    <span className="ml-2 text-xs text-gold">(you)</span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-surface-muted">
                  {p.id.slice(0, 8)}…
                </div>
              </div>

              <div>
                <span className="label">Role</span>
                <select
                  value={p.role}
                  onChange={(e) => setRole(p, e.target.value as Role)}
                  disabled={p.id === selfId}
                  className="input min-w-[10rem]"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {p.role === "facility" && (
                <div>
                  <span className="label">Facility</span>
                  <select
                    value={p.facility_id ?? ""}
                    onChange={(e) =>
                      setFacilityId(p, e.target.value || null)
                    }
                    className="input min-w-[12rem]"
                  >
                    <option value="">— select —</option>
                    {facilities.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.short_name || f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {p.role === "staff" && (
              <div className="mt-3">
                <span className="label">Assigned facilities</span>
                <div className="flex flex-wrap gap-2">
                  {facilities.map((f) => {
                    const on = assigned.has(f.id);
                    return (
                      <button
                        key={f.id}
                        onClick={() => toggleAssignment(p, f.id)}
                        className={`badge border transition ${
                          on
                            ? "border-gold bg-gold/15 text-gold"
                            : "border-surface-border bg-surface text-surface-muted hover:border-surface-muted"
                        }`}
                      >
                        {on ? "✓ " : "+ "}
                        {f.short_name || f.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {(p.role === "facility" || p.role === "staff") && (
              <div className="mt-3">
                <span className="label">
                  Visible tabs{" "}
                  <span className="font-normal normal-case text-surface-muted">
                    (none selected = all tabs for their role)
                  </span>
                </span>
                <div className="flex flex-wrap gap-2">
                  {TABS.filter((t) => t.roles.includes(p.role)).map((t) => {
                    const on = !p.allowed_tabs || p.allowed_tabs.includes(t.href);
                    return (
                      <button
                        key={t.href}
                        onClick={() => toggleTab(p, t.href)}
                        className={`badge border transition ${
                          on
                            ? "border-brand-blue bg-brand-blue/15 text-brand-blue"
                            : "border-surface-border bg-surface text-surface-muted hover:border-surface-muted"
                        }`}
                      >
                        {on ? "✓ " : "+ "}
                        {t.label}
                      </button>
                    );
                  })}
                </div>
                {p.role === "facility" && (
                  <p className="mt-1 text-xs text-surface-muted">
                    Facility logins are always read-only and limited to their own
                    facility&apos;s data by the database.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
      {profiles.length === 0 && (
        <p className="text-sm text-surface-muted">No users yet.</p>
      )}
    </div>
  );
}

function FacilitiesTab({
  facilities,
  setFacilities,
  flash,
}: {
  facilities: Facility[];
  setFacilities: React.Dispatch<React.SetStateAction<Facility[]>>;
  flash: (m: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [state, setState] = useState("NJ");

  const add = async () => {
    if (!name.trim()) return;
    const { data, error } = await supabase
      .from("facilities")
      .insert({ name: name.trim(), short_name: shortName.trim() || null, state })
      .select()
      .single();
    if (error) {
      flash(`Error: ${error.message}`);
      return;
    }
    setFacilities((prev) => [...prev, data as Facility]);
    setName("");
    setShortName("");
    flash("Facility added");
  };

  const save = async (f: Facility, partial: Partial<Facility>) => {
    setFacilities((prev) =>
      prev.map((x) => (x.id === f.id ? { ...x, ...partial } : x))
    );
    const { error } = await supabase
      .from("facilities")
      .update(partial)
      .eq("id", f.id);
    if (error) flash(`Error: ${error.message}`);
  };

  const remove = async (f: Facility) => {
    if (!confirm(`Delete ${f.name}? This removes its claims and data.`)) return;
    setFacilities((prev) => prev.filter((x) => x.id !== f.id));
    const { error } = await supabase.from("facilities").delete().eq("id", f.id);
    flash(error ? `Error: ${error.message}` : "Facility deleted");
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="label">Add facility</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <span className="label">Legal name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="EXAMPLE RECOVERY LLC"
            />
          </div>
          <div>
            <span className="label">Short name</span>
            <input
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              className="input"
              placeholder="Example"
            />
          </div>
          <div>
            <span className="label">State</span>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="input w-20"
            />
          </div>
          <button onClick={add} className="btn-primary">
            Add
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface">
            <tr>
              <th className="th">Legal name</th>
              <th className="th">Short name</th>
              <th className="th">State</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f, idx) => (
              <tr key={f.id} className={idx % 2 ? "bg-surface/40" : ""}>
                <td className="td">
                  <input
                    defaultValue={f.name}
                    onBlur={(e) =>
                      e.target.value !== f.name && save(f, { name: e.target.value })
                    }
                    className="cell-input min-w-[16rem]"
                  />
                </td>
                <td className="td">
                  <input
                    defaultValue={f.short_name ?? ""}
                    onBlur={(e) =>
                      e.target.value !== (f.short_name ?? "") &&
                      save(f, { short_name: e.target.value })
                    }
                    className="cell-input"
                  />
                </td>
                <td className="td">
                  <input
                    defaultValue={f.state ?? ""}
                    onBlur={(e) =>
                      e.target.value !== (f.state ?? "") &&
                      save(f, { state: e.target.value })
                    }
                    className="cell-input w-16"
                  />
                </td>
                <td className="td text-right">
                  <button
                    onClick={() => remove(f)}
                    className="text-xs font-semibold text-risk hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateUserTab({
  onCreated,
  flash,
}: {
  onCreated: () => void;
  flash: (m: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/admin/create-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        full_name: fullName,
        password: invite ? undefined : password,
        invite,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setResult(`Error: ${json.error}`);
      return;
    }
    setResult(
      invite
        ? `Invite sent to ${email}.`
        : `User ${email} created. Set their role in the Users tab.`
    );
    setEmail("");
    setFullName("");
    setPassword("");
    flash("User created");
    setTimeout(onCreated, 600);
  };

  return (
    <form onSubmit={submit} className="card max-w-lg space-y-4 p-6">
      <div>
        <span className="label">Full name</span>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="input"
          placeholder="Daniel Rivera"
        />
      </div>
      <div>
        <span className="label">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
          placeholder="daniel@example.com"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={invite}
          onChange={(e) => setInvite(e.target.checked)}
          className="h-4 w-4 accent-gold"
        />
        Send an email invite (user sets their own password)
      </label>

      {!invite && (
        <div>
          <span className="label">Temporary password</span>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            placeholder="At least 6 characters"
            minLength={6}
            required={!invite}
          />
        </div>
      )}

      <button type="submit" disabled={busy} className="btn-gold w-full">
        {busy ? "Working…" : invite ? "Send invite" : "Create user"}
      </button>

      {result && (
        <p
          className={`text-sm ${
            result.startsWith("Error") ? "text-risk" : "text-recovered"
          }`}
        >
          {result}
        </p>
      )}

      <p className="text-xs text-surface-muted">
        New users start as <b>pending</b>. After creating, assign their role and
        facilities in the Users tab. Requires{" "}
        <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> set on the
        server.
      </p>
    </form>
  );
}
