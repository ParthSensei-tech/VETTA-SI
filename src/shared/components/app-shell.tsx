import { Link, useRouterState } from "@tanstack/react-router";
import React from "react";
import {
  Activity,
  ClipboardCheck,
  Flame,
  Inbox,
  LayoutGrid,
  Plus,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { PlanBanner } from "@/shared/components/plan-banner";
import { UserMenu } from "@/shared/components/user-menu";
import { VettaWordmark } from "@/shared/components/vetta-mark";
import { CommandMenu } from "@/shared/components/ui/command-menu";
import { cn } from "@/shared/utils";

// Leads stays listed for everyone — the page itself refuses non-owners, which
// beats a nav item that silently appears only for one person per workspace.
const NAV = [
  { to: "/app", label: "Desk", icon: LayoutGrid, exact: true, premium: false },
  { to: "/app/triage", label: "Daily Triage", icon: Flame, exact: false, premium: false },
  { to: "/app/approvals", label: "Approvals", icon: ClipboardCheck, exact: false, premium: false },
  { to: "/app/talent", label: "Talent", icon: Users, exact: false, premium: false },
  { to: "/app/offer-guard", label: "Offer Guard", icon: ShieldAlert, exact: false, premium: true },
  { to: "/app/portal", label: "Portal", icon: Rocket, exact: false, premium: true },
  { to: "/app/harness", label: "Harness", icon: ShieldCheck, exact: false, premium: false },
  {
    to: "/app/observability",
    label: "Observability",
    icon: Activity,
    exact: false,
    premium: false,
  },
  { to: "/app/admin-leads", label: "Leads", icon: Inbox, exact: false, premium: false },
  { to: "/app/agency-metrics", label: "Agency Metrics", icon: TrendingUp, exact: false, premium: false },
] satisfies Array<{ to: string; label: string; icon: React.ComponentType<{ className?: string }>; exact: boolean; premium: boolean }>;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-dvh text-fg">
      <CommandMenu />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-[var(--glass-fill)] px-4 py-6 backdrop-blur-[var(--glass-blur)] md:flex">
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
                  "flex h-11 items-center gap-3 rounded-lg px-3 text-sm transition-[background-color,color,box-shadow] duration-150",
                  active
                    ? "bg-primary/15 text-fg shadow-[var(--shadow-soft-1)]"
                    : "text-muted hover:bg-[var(--glass-fill-strong)] hover:text-fg",
                )}
              >
                <item.icon className={cn("size-4", active && "text-accent")} />
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
          className="flex h-11 items-center justify-center gap-2 rounded-lg soft-lime text-sm font-medium text-primary-foreground"
        >
          <Plus className="size-4" />
          New role
        </Link>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-[var(--glass-fill-strong)] px-4 backdrop-blur-[var(--glass-blur)] md:hidden">
        <Link to="/app">
          <VettaWordmark />
        </Link>
        <div className="flex items-center gap-1">
          <UserMenu />
        </div>
      </header>

      <div className="md:pl-56">
        <div className="hidden h-14 items-center justify-end gap-1 border-b border-border px-6 md:flex">
          <UserMenu />
        </div>
        <PlanBanner />
        <main className="px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-12">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-8 border-t border-border bg-[var(--glass-fill-strong)] pb-[env(safe-area-inset-bottom)] backdrop-blur-[var(--glass-blur)] md:hidden">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-1 text-[11px]",
                active ? "text-accent" : "text-muted",
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
