/** Static bust for reduced-motion, low-end devices and scene failures. */
export function BustFallback({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`l-bust-static ${className ?? ""}`} />;
}