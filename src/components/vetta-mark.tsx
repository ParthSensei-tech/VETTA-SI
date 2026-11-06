import { cn } from "@/shared/utils";

export function VettaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("text-accent", className)} aria-hidden="true">
      <rect x="3" y="14" width="4.2" height="7" rx="1" fill="currentColor" opacity="0.4" />
      <rect x="9.9" y="8" width="4.2" height="13" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="16.8" y="3" width="4.2" height="18" rx="1" fill="currentColor" />
    </svg>
  );
}

export function VettaWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <VettaMark className="size-5" />
      <span className="font-display text-lg font-medium tracking-tight">Vetta</span>
    </span>
  );
}
