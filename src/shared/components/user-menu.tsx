import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { signOut } from "@/platform/auth/client";
import { useCurrentUserState } from "@/platform/auth/use-current-user";
import { initials } from "@/shared/utils";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

export function UserMenu() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  if (isPending) {
    return <div className="size-9 animate-pulse rounded-full bg-elevated" />;
  }
  if (!user) {
    return (
      <Button asChild size="sm">
        <Link to="/login">Sign in</Link>
      </Button>
    );
  }

  const label = user.displayName ?? user.primaryEmail ?? "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-elevated text-xs font-medium text-fg shadow-[var(--shadow-border)]"
          aria-label="Account"
        >
          {user.profileImageUrl ? (
            <img src={user.profileImageUrl} alt="" className="size-full object-cover" />
          ) : (
            initials(label)
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-3 py-2">
          <p className="truncate text-sm font-medium">{label}</p>
          {user.primaryEmail ? (
            <p className="truncate text-xs text-muted">{user.primaryEmail}</p>
          ) : null}
        </div>
        <DropdownMenuItem onSelect={() => void navigate({ to: "/jobs" })}>
          Candidate portal
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={() => {
            setSigningOut(true);
            void signOut("/").catch(() => setSigningOut(false));
          }}
        >
          <LogOut className="size-4" />
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
