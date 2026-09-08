import { requireProfile } from "@/lib/auth";
import Header from "@/components/Header";

// Shown to any user whose role is "suspended". Middleware bounces every other
// route here, so a suspended login can only ever see this notice + Sign out.
export default async function SuspendedPage() {
  const { profile, email } = await requireProfile();

  return (
    <>
      <Header profile={profile} email={email} subtitle="Access suspended" />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="card max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-risk/15 text-2xl text-risk">
            ⛔
          </div>
          <h1 className="mb-2 text-xl font-bold">Your access is suspended</h1>
          <p className="text-sm text-surface-muted">
            This account has been suspended and can&apos;t access Recovery Desk right
            now. Please contact management if you believe this is a mistake.
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
