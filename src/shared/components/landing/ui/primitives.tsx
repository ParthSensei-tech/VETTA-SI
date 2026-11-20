import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/utils";

export function GlassPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("l-glass rounded-3xl", className)}>{children}</div>;
}

export function PillLink({
  variant = "ember",
  className,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: "ember" | "ghost";
  children: ReactNode;
}) {
  return (
    <a
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold",
        variant === "ember" ? "l-pill-ember" : "l-pill-ghost",
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
}