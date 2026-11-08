"use client";
import { useEffect } from "react";
import { flushQueue } from "@/lib/offline-queue";

/** Registers /sw.js and flushes the offline diary queue when connectivity returns. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    const onMsg = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === "flush-queue") void flushQueue();
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);
  useEffect(() => {
    const on = () => void flushQueue();
    window.addEventListener("online", on);
    void flushQueue();
    return () => window.removeEventListener("online", on);
  }, []);
  return null;
}
