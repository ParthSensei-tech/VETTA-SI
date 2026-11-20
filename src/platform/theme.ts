// The software ships one identity — Midnight Black / Pure White / Lime Green.
// There is no light mode and no toggle; these helpers exist so SSR boot, the
// provider and the theme-color meta all agree on that single look.
export type Theme = "dark";

export const THEME_DARK = "#0b0b0c";

export const THEME_BOOT_SCRIPT =
  '(function(){var r=document.documentElement;r.classList.add("dark");r.style.colorScheme="dark";})();';

export function applyTheme() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.add("dark");
  root.style.colorScheme = "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_DARK);
}
