"use client";
/**
 * Offline-first diary writes: try the network, otherwise park the request in IndexedDB and
 * replay it when the connection returns (online event, Background Sync or next app open).
 * Entries carry a clientId, so replays are idempotent on the server.
 */
import { openDB, type IDBPDatabase } from "idb";

type Pending = { id: string; url: string; method: string; body: unknown; createdAt: number; tries: number };

let dbp: Promise<IDBPDatabase> | null = null;
const idb = () => (dbp ??= openDB("nutria", 1, { upgrade: (d) => d.createObjectStore("queue", { keyPath: "id" }) }));

export const newClientId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function pendingCount() {
  try {
    return await (await idb()).count("queue");
  } catch {
    return 0;
  }
}

/** POST with offline fallback. Returns { queued: true } when parked. */
export async function sendOrQueue<T = unknown>(url: string, body: unknown, method = "POST"): Promise<{ ok: true; queued: boolean; data?: T }> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({})))?.error ?? `Error ${res.status}`), { http: true });
    return { ok: true, queued: false, data: (await res.json().catch(() => undefined)) as T };
  } catch (e) {
    if ((e as { http?: boolean }).http) throw e;
    await (await idb()).put("queue", { id: newClientId(), url, method, body, createdAt: Date.now(), tries: 0 } satisfies Pending);
    try {
      const reg = await navigator.serviceWorker?.ready;
      await (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })?.sync?.register("nutria-diary");
    } catch {
      /* Background Sync not supported: the online listener flushes instead. */
    }
    window.dispatchEvent(new Event("nutria-queue"));
    return { ok: true, queued: true };
  }
}

let flushing = false;
export async function flushQueue() {
  if (flushing || (typeof navigator !== "undefined" && !navigator.onLine)) return 0;
  flushing = true;
  let sent = 0;
  try {
    const db = await idb();
    const items = (await db.getAll("queue")) as Pending[];
    for (const it of items.sort((a, b) => a.createdAt - b.createdAt)) {
      try {
        const res = await fetch(it.url, { method: it.method, headers: { "content-type": "application/json" }, body: JSON.stringify(it.body) });
        if (res.ok || (res.status >= 400 && res.status < 500 && it.tries >= 3)) {
          await db.delete("queue", it.id);
          if (res.ok) sent++;
        } else await db.put("queue", { ...it, tries: it.tries + 1 });
      } catch {
        break; // still offline
      }
    }
  } finally {
    flushing = false;
  }
  if (sent) window.dispatchEvent(new CustomEvent("nutria-synced", { detail: sent }));
  window.dispatchEvent(new Event("nutria-queue"));
  return sent;
}
