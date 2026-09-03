"use client";

import { useEffect, useState } from "react";

/**
 * One clock for a whole surface.
 *
 * A run that is still going has to count up, and a relative label ("4 minutes ago") has to age, but
 * neither is worth a timer per row: one interval ticks the page, once a second while something is
 * still open and lazily when everything has finished.
 */
export function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const everyMs = live ? 1_000 : 30_000;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);

  return now;
}
