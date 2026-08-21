/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Pages: try network, fall back to cache so the app opens offline.
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "pages",
        networkTimeoutSeconds: 5,
        plugins: [{ cacheWillUpdate: async ({ response }) => (response.status === 200 ? response : null) }],
      }),
    },
    ...defaultCache,
  ],
});

// Background Sync: the page registers tag "outbox-sync"; we ask it to drain the outbox.
// The outbox lives in the page (it needs the Supabase client), so we message clients
// rather than duplicating auth here.
self.addEventListener("sync", (event) => {
  const e = event as ExtendableEvent & { tag: string };
  if (e.tag !== "outbox-sync") return;
  e.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      for (const c of clients) c.postMessage({ type: "outbox-sync" });
    })
  );
});

serwist.addEventListeners();
