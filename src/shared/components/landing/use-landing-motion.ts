import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * The switch the stylesheet cannot throw.
 *
 * `src/styles.css` clamps CSS animation and transition durations under
 * `prefers-reduced-motion`, which is the right thing for DOM motion and the
 * whole story for DOM motion. A WebGL frame loop is not a CSS animation: nothing
 * in that media query stops it. So the preference is read here, and the landing
 * page uses it as a mount condition — when it is on, the scene module is never
 * imported and the static composition is what renders.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduce(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduce;
}

/** True while the tab is in the foreground; a hidden tab has no business rendering. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}

/**
 * Whether the element is on screen, reported only when it changes.
 *
 * The hero is the one part of the page worth pixels-per-second; once it has
 * scrolled away it should cost nothing. `rootMargin` keeps the handoff quiet at
 * the boundary so a half-visible hero is not treated as offscreen.
 */
export function useSectionInView<T extends HTMLElement>(
  margin = "10%",
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? false),
      { rootMargin: margin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [margin]);

  return [ref, inView];
}
