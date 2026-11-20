import { createFileRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/shared/components/app-shell";
import { RedirectToSignIn } from "@/platform/auth/gates";
import { useCurrentUserState } from "@/platform/auth/use-current-user";
import { getSignupProfile, signupProfileQueryKey } from "@/features/marketing/api/signups";
import { Skeleton } from "@/shared/components/ui/skeleton";

export const Route = createFileRoute("/app")({ component: AppLayout });

function AppLayout() {
  const { user, isPending } = useCurrentUserState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Asked once, at setup — never on a later login. An account that has answered
  // returns `complete: true` and this check disappears from the flow entirely.
  const profile = useQuery({
    queryKey: signupProfileQueryKey,
    queryFn: () => getSignupProfile(),
    enabled: Boolean(user),
  });

  if (isPending) {
    return (
      <div className="min-h-dvh p-8">
        <Skeleton className="h-8 w-40" />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (!user) return <RedirectToSignIn />;

  if (profile.data && !profile.data.complete && pathname !== "/app/setup") {
    return <Navigate to="/app/setup" />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
