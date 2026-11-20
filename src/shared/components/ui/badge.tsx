import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/shared/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide",
  {
    variants: {
      variant: {
        default: "bg-[var(--glass-fill)] text-muted ring-1 ring-[var(--glass-hairline)]",
        solid: "bg-primary text-primary-foreground shadow-[var(--shadow-soft-1)]",
        success: "bg-success/15 text-success",
        warn: "bg-warn/15 text-warn",
        danger: "bg-danger/15 text-danger",
        outline: "border border-border text-muted",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
