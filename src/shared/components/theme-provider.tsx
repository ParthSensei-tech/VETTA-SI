import { createContext, useContext, useEffect, type ReactNode } from "react";
import { applyTheme, type Theme } from "@/platform/theme";

// Single-theme app: the provider exists so consumers (toasts) keep one source
// of truth and the boot script and DOM state never disagree.
const ThemeContext = createContext<{ theme: Theme }>({ theme: "dark" });

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyTheme();
  }, []);

  return <ThemeContext.Provider value={{ theme: "dark" }}>{children}</ThemeContext.Provider>;
}

// Hook shares this file with the provider on purpose.
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  return useContext(ThemeContext);
}
