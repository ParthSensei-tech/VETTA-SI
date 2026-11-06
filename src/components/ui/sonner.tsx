import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/components/theme-provider";

export function Toaster() {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "bg-elevated text-fg border-border shadow-[var(--shadow-border)]",
          description: "text-muted",
          actionButton: "bg-primary text-primary-foreground",
        },
      }}
    />
  );
}
