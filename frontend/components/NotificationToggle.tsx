"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  isPushSupported,
  registerServiceWorker,
  getCurrentSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push";

// isPushSupported() reads browser APIs that don't exist during SSR, so
// computing it inline would mismatch the server's render (always
// unsupported) against the client's first render — same hydration trap as
// getCurrentUserId() in lib/auth.ts, same fix.
function subscribeNoop() {
  return () => {};
}

export function NotificationToggle() {
  const supported = useSyncExternalStore(subscribeNoop, isPushSupported, () => false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPushSupported()) return;
    registerServiceWorker()
      .then(() => getCurrentSubscription())
      .then((sub) => setSubscribed(sub !== null))
      .catch(() => setError("Failed to check notification status"));
  }, []);

  async function handleToggle() {
    setBusy(true);
    setError(null);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
      } else {
        await subscribeToPush();
        setSubscribed(true);
      }
    } catch {
      setError(subscribed ? "Failed to disable notifications" : "Failed to enable notifications");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleToggle}
        disabled={busy}
        className="rounded-full border px-4 py-2 text-sm disabled:opacity-50"
      >
        {subscribed ? "Disable notifications" : "Enable notifications"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
