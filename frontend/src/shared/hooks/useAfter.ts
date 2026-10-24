"use client";

import { useEffect, useState } from "react";

/** True once performance.now() has passed `at` (ms). Infinity never passes. */
export function useAfter(at: number | null | undefined) {
  const [passedAt, setPassedAt] = useState<number | null>(null);
  useEffect(() => {
    if (at == null || !Number.isFinite(at)) return;
    const id = setTimeout(() => setPassedAt(at), Math.max(0, at - performance.now()));
    return () => clearTimeout(id);
  }, [at]);
  return at == null || passedAt === at;
}
