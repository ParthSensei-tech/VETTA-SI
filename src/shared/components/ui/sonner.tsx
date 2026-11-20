import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/shared/components/theme-provider";

export function Toaster() {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "glass-strong text-fg",
          description: "text-muted",
          actionButton: "bg-primary text-primary-foreground",
        },
      }}
    />
  );
}
