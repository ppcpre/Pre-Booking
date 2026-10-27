"use client";
import { useEffect } from "react";

/** After sign-out, ask the service worker to drop cached pages so the next person sees nothing. */
export function ClearCacheOnSignOut() {
  useEffect(() => {
    navigator.serviceWorker?.controller?.postMessage("clear-cache");
  }, []);
  return null;
}
