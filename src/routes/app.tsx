import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/shared/components/app-shell";
import { RedirectToSignIn } from "@/platform/auth/gates";
import { useCurrentUserState } from "@/platform/auth/use-current-user";
import { Skeleton } from "@/shared/components/ui/skeleton";

export const Route = createFileRoute("/app")({ component: AppLayout });

function AppLayout() {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return (
      <div className="min-h-dvh bg-bg p-8">
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

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
