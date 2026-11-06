import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/shared/components/theme-provider";
import { cn } from "@/shared/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDay = theme === "light";

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-3 text-sm text-muted transition-colors duration-150 hover:bg-elevated hover:text-fg",
        className,
      )}
      aria-label={isDay ? "Switch to night mode" : "Switch to day mode"}
      title={isDay ? "Night mode" : "Day mode"}
    >
      {isDay ? <Moon className="size-4" /> : <Sun className="size-4" />}
      <span className="hidden sm:inline">{isDay ? "Night" : "Day"}</span>
    </button>
  );
}
