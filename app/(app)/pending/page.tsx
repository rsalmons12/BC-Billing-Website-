import { requireProfile } from "@/lib/auth";
import Header from "@/components/Header";

export default async function PendingPage() {
  const { profile, email } = await requireProfile();

  return (
    <>
      <Header profile={profile} email={email} subtitle="Welcome" />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="card max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gold/15 text-2xl text-gold">
            ⏳
          </div>
          <h1 className="mb-2 text-xl font-bold">Access not set up yet</h1>
          <p className="text-sm text-surface-muted">
            Your account has been created but a role hasn&apos;t been assigned.
            Please contact management to get access to Recovery Desk.
          </p>
          <form action="/auth/signout" method="post" className="mt-6">
            <button className="btn-ghost w-full" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
