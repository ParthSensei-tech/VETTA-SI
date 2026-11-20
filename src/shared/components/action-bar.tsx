import { type ReactNode } from "react";
import { cn } from "@/shared/utils";

export interface MobileActionBarProps {
  children: ReactNode;
  className?: string;
}

/**
 * Fitts's Law Mobile Action Bar
 *
 * Positions high-frequency primary workflow actions directly in the natural
 * thumb sweep zone at the bottom of mobile screens, eliminating reach strain.
 */
export function MobileActionBar({ children, className }: MobileActionBarProps) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-border bg-[var(--glass-fill-strong)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-[var(--glass-blur)] md:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
