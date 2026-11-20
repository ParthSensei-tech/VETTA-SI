import { useEffect, useState } from "react";
import { HERO } from "../content/site";

/**
 * Decorative background. Video only on capable desktop connections; everyone
 * else gets the poster, which is also the LCP element and the reduced-motion
 * experience.
 */
export function HeroBackdrop() {
  const [mode, setMode] = useState<"poster" | "video">("poster");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mobile = matchMedia("(max-width: 767px)").matches;
    const saveData =
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
      true;
    if (!mobile && !saveData && HERO.video) setMode("video");
  }, []);

  if (mode === "video" && !failed && HERO.video) {
    return (
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src={HERO.video}
        poster={HERO.poster}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <img
      src={HERO.poster}
      alt=""
      aria-hidden="true"
      fetchPriority="high"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}