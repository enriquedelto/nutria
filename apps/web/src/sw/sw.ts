/// <reference lib="webworker" />
/**
 * Nutria service worker (bundled to public/sw.js by scripts/build-sw.mjs).
 * - Static assets: cache-first; pages: network-first with /offline fallback.
 * - API reads (search, foods) are cached briefly so search works on flaky connections.
 * - Diary writes made offline live in IndexedDB on the client (lib/offline-queue.ts), not here.
 * - Push notifications + click routing.
 */
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate } from "serwist";

declare const self: ServiceWorkerGlobalScope;
declare const __SW_VERSION__: string;

const serwist = new Serwist({
  precacheEntries: [
    { url: "/offline", revision: __SW_VERSION__ },
    { url: "/icons/icon.svg", revision: __SW_VERSION__ },
    { url: "/icons/icon-192.png", revision: __SW_VERSION__ },
  ],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({ cacheName: "static", plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 })] }),
    },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/_next/image")),
      handler: new StaleWhileRevalidate({ cacheName: "images", plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 })] }),
    },
    {
      matcher: ({ url, sameOrigin, request }) => sameOrigin && request.method === "GET" && /^\/api\/(foods|off)\b/.test(url.pathname),
      handler: new NetworkFirst({ cacheName: "api-foods", networkTimeoutSeconds: 4, plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 })] }),
    },
    {
      matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
      handler: new NetworkFirst({ cacheName: "pages", networkTimeoutSeconds: 5, plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 })] }),
    },
  ],
  fallbacks: { entries: [{ url: "/offline", matcher: ({ request }) => request.destination === "document" }] },
});

serwist.addEventListeners();

type PushPayload = { title: string; body?: string; url?: string; tag?: string; icon?: string };

self.addEventListener("push", (event) => {
  let data: PushPayload = { title: "Nutria" };
  try {
    data = event.data?.json() as PushPayload;
  } catch {
    data = { title: "Nutria", body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: data.icon ?? "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      data: { url: data.url ?? "/hoy" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/hoy";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = all.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        await existing.navigate(url).catch(() => undefined);
      } else await self.clients.openWindow(url);
    })(),
  );
});

// The page asks the worker to flush the offline queue when Background Sync fires.
self.addEventListener("sync", (event) => {
  const e = event as ExtendableEvent & { tag?: string };
  if (e.tag === "nutria-diary") {
    e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => cs.forEach((c) => c.postMessage({ type: "flush-queue" }))));
  }
});
