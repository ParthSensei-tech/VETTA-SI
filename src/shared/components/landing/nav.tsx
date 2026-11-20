import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/platform/auth/use-current-user";
import { NAV_LINKS, HERO } from "./content/site";
import { PillLink } from "./ui/primitives";

export function LandingNav() {
  const { user, isPending } = useCurrentUserState();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const signedIn = mounted && !isPending && !!user;

  return (
    <header className="sticky top-0 z-40 border-b border-l-hairline bg-l-bg/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8">
        <Link
          to="/"
          aria-label="Vetta home"
          className="font-l-display text-sm tracking-[0.35em] text-l-text"
        >
          VETTA
        </Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-4 md:flex lg:gap-7">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-xs text-l-muted transition-colors hover:text-l-text"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <Link
            to="/waitlist"
            className="hidden text-xs font-semibold text-emerald-400 transition-colors hover:text-emerald-300 sm:inline"
          >
            VIP Waitlist (Cohort 1)
          </Link>
          <Link
            to={signedIn ? "/app" : "/login"}
            className="hidden text-xs text-l-muted transition-colors hover:text-l-text sm:inline"
          >
            {signedIn ? "Open workspace" : "Sign in"}
          </Link>
          <PillLink href="#demo" className="px-4 py-2 text-xs">
            {HERO.primaryCta}
          </PillLink>
        </div>
      </div>
    </header>
  );
}