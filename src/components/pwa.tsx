"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// Chrome/Edge/Android fire `beforeinstallprompt` once; keep it so the menu can offer "Install app" later.
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

function useInstallPrompt() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => deferred,
    () => null,
  );
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** "Install app" entry for the profile menu. Hidden when the app is already installed. */
export function InstallMenuItem() {
  const prompt = useInstallPrompt();
  const [env, setEnv] = useState<{ standalone: boolean; ios: boolean } | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  useEffect(() => setEnv({ standalone: isStandalone(), ios: isIOS() }), []);

  if (!env || env.standalone) return null;
  if (prompt) {
    return (
      <button
        type="button"
        className="plain"
        onClick={async () => {
          await prompt.prompt();
          await prompt.userChoice;
          deferred = null;
          emit();
        }}
      >
        Install app on this device<small>Opens full screen, works on weak signal</small>
      </button>
    );
  }
  if (env.ios) {
    return (
      <button type="button" className="plain" onClick={() => setShowIosHelp((v) => !v)}>
        Install app on this iPhone
        <small>{showIosHelp ? "In Safari, tap Share, then Add to Home Screen" : "Show how"}</small>
      </button>
    );
  }
  return null;
}

/** Thin bar shown while the device is offline. */
export function OfflineBar() {
  const online = useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return <div className="offline-bar" role="status">You&apos;re offline. Showing what was loaded last; changes need a connection.</div>;
}
