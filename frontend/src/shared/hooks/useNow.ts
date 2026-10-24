"use client";

import { useEffect, useState } from "react";

/** Date.now(), refreshed every `ms` while `active`. */
export function useNow(active: boolean, ms = 100) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/** Whole seconds left until `at` (epoch ms), never negative. */
export function secondsUntil(at: number, now: number) {
  return Math.max(0, Math.ceil((at - now) / 1000));
}
