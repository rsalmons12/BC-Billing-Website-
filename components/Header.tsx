import type { Profile } from "@/lib/types";

const ROLE_LABELS: Record<string, string> = {
  management: "Management",
  staff: "Staff · Collector",
  facility: "Facility",
  pending: "Pending",
};

export default function Header({
  profile,
  email,
  subtitle,
}: {
  profile: Profile;
  email: string | null;
  subtitle?: string;
}) {
  const name = profile.full_name || email || "User";
  const initials =
    profile.initials ||
    name
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

  return (
    <header className="flex items-center justify-between gap-3 border-b border-surface-border bg-surface-card px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <div className="truncate font-display text-base font-bold text-surface-ink sm:text-lg">
          {subtitle ?? "Recovery Desk"}
        </div>
      </div>
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="hidden text-right leading-tight sm:block">
          <div className="text-sm font-semibold text-surface-ink">{name}</div>
          <div className="text-xs text-surface-muted">
            {ROLE_LABELS[profile.role] ?? profile.role}
          </div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-command text-xs font-bold text-command-text">
          {initials}
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-surface-border px-3 py-1.5 text-sm font-semibold text-surface-muted transition hover:bg-surface hover:text-surface-ink"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
