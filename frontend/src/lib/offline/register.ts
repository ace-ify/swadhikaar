import { syncNow } from "./outbox";

let started = false;

/** Registers the service worker and drains the outbox whenever connectivity looks back. */
export function startOfflineRuntime() {
  if (started || typeof window === "undefined") return;
  started = true;

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // ponytail: no SW (dev, http, unsupported) just means no offline shell; the outbox still works.
    });
    navigator.serviceWorker.addEventListener("message", (e) => {
      if ((e.data as { type?: string } | null)?.type === "outbox-sync") void syncNow();
    });
  }

  const drain = () => {
    if (navigator.onLine) void syncNow();
  };
  window.addEventListener("online", drain);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") drain();
  });
  drain();
}

/** Ask the browser to retry for us after the tab is closed. Falls back silently. */
export async function requestBackgroundSync() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    await reg.sync?.register("outbox-sync");
  } catch {
    // Background Sync is Chromium-only; the online/visibilitychange listeners cover the rest.
  }
}
