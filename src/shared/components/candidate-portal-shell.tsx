import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { VettaMark, VettaWordmark } from "@/shared/components/vetta-mark";

export function CandidatePortalShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link to="/jobs" aria-label="Vetta open roles">
          <VettaWordmark />
        </Link>
        <nav className="flex items-center gap-2 text-sm sm:gap-4">
          <Link
            to="/jobs"
            className="hidden text-muted transition-colors duration-150 hover:text-fg sm:inline"
          >
            Open roles
          </Link>
          <Link
            to="/"
            className="hidden text-muted transition-colors duration-150 hover:text-fg sm:inline"
          >
            Home
          </Link>
          <Link to="/login" className="text-muted transition-colors duration-150 hover:text-fg">
            Recruiter sign in
          </Link>
          <ThemeToggle className="size-11 min-w-11 px-0 sm:min-w-0 sm:px-3" />
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-24">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 text-xs text-subtle">
          <span className="inline-flex items-center gap-2">
            <VettaMark className="size-3.5" />
            Vetta · Candidates
          </span>
          <span>Written screens. Human-gated offers.</span>
        </div>
      </footer>
    </div>
  );
}
