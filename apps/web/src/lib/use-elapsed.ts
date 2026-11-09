"use client";
import { useEffect, useState } from "react";

/** Whole seconds since `running` became true (0 while stopped). For "it's taking a while" feedback. */
export function useElapsed(running: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const id = setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => {
      clearInterval(id);
      setS(0);
    };
  }, [running]);
  return s;
}
