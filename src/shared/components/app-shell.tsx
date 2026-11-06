import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  ClipboardCheck,
  LayoutGrid,
  Plus,
  Rocket,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { UserMenu } from "@/shared/components/user-menu";
import { VettaWordmark } from "@/shared/components/vetta-mark";
import { cn } from "@/shared/utils";

const NAV = [
  { to: "/app", label: "Desk", icon: LayoutGrid, exact: true, premium: false },
  { to: "/app/approvals", label: "Approvals", icon: ClipboardCheck, exact: false, premium: false },
  { to: "/app/talent", label: "Talent", icon: Users, exact: false, premium: false },
  { to: "/app/portal", label: "Portal", icon: Rocket, exact: false, premium: true },
  { to: "/app/harness", label: "Harness", icon: ShieldCheck, exact: false, premium: false },
  {
    to: "/app/observability",
    label: "Observability",
    icon: Activity,
    exact: false,
    premium: false,
  },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-bg px-4 py-6 md:flex">
        <Link to="/app" className="px-2">
          <VettaWordmark />
        </Link>
        <nav className="mt-10 flex flex-1 flex-col gap-1">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150",
                  active ? "bg-elevated text-fg" : "text-muted hover:bg-surface hover:text-fg",
                )}
              >
                <item.icon className="size-4" />
                <span className="flex-1">{item.label}</span>
                {item.premium && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    Pro
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <Link
          to="/app/roles/new"
          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground"
        >
          <Plus className="size-4" />
          New role
        </Link>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-bg/90 px-4 backdrop-blur md:hidden">
        <Link to="/app">
          <VettaWordmark />
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle className="size-11 min-w-11 px-0" />
          <UserMenu />
        </div>
      </header>

      <div className="md:pl-56">
        <div className="hidden h-14 items-center justify-end gap-1 border-b border-border px-6 md:flex">
          <ThemeToggle />
          <UserMenu />
        </div>
        <main className="px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-12">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-1 text-[11px]",
                active ? "text-fg" : "text-muted",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
        <Link
          to="/app/roles/new"
          className="flex h-14 flex-col items-center justify-center gap-1 text-[11px] text-muted"
        >
          <Plus className="size-4" />
          Role
        </Link>
      </nav>
    </div>
  );
}
