"use client";
import { useEffect, useState } from "react";
import { useBrowserCheck } from "@/components/forms";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Enables Web Push for this device (iPhone: the Jarvis app must be installed to the Home Screen). */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const supported = useBrowserCheck(() => "serviceWorker" in navigator && "PushManager" in window) && Boolean(publicKey);
  const blocked = useBrowserCheck(() => "Notification" in window && Notification.permission === "denied");
  const [sub, setSub] = useState<"unknown" | "off" | "on" | "denied">("unknown");
  const [msg, setMsg] = useState<string | null>(null);
  const state = !supported ? "unsupported" : blocked ? "denied" : sub;
  const setState = setSub;

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((s) => setSub(s ? "on" : "off")).catch(() => setSub("off"));
  }, [supported]);

  async function enable() {
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey!) });
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error("Couldn't save the subscription");
      setState("on");
      setMsg("Notifications on for this device.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
  }

  if (state === "unsupported") return <p className="text-sm text-muted">{publicKey ? "This browser can't receive push notifications. On iPhone, install Jarvis to the Home Screen first (iOS 16.4+)." : "Push isn't configured (VAPID keys missing)."}</p>;
  if (state === "denied") return <p className="text-sm text-warn">Notifications are blocked for Jarvis in this browser&apos;s settings.</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === "on" ? <button type="button" onClick={disable} className="btn btn-ghost btn-sm">Turn off on this device</button> : <button type="button" onClick={enable} className="btn btn-primary btn-sm" disabled={state === "unknown"}>Enable notifications</button>}
      {msg && <span className="text-sm text-muted">{msg}</span>}
    </div>
  );
}
