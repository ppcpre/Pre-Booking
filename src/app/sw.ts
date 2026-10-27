/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

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
    // Never cache sign-in and sign-out, or Supabase API calls (personal data, always fresh).
    { matcher: ({ url }) => url.pathname.startsWith("/auth/") || url.pathname === "/login", handler: new NetworkOnly() },
    { matcher: ({ url }) => url.hostname.endsWith(".supabase.co"), handler: new NetworkOnly() },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [{ url: "/~offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

// Clear cached pages when someone signs out, so the next person on this device sees nothing.
self.addEventListener("message", (event) => {
  if (event.data === "clear-cache") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

serwist.addEventListeners();
