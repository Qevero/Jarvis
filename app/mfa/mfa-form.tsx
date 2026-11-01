"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/safe-next";

type Mode = { kind: "loading" } | { kind: "verify"; factorId: string } | { kind: "enrol"; factorId: string; qr: string; secret: string } | { kind: "error"; message: string };

/**
 * MFA is mandatory. First visit: enrol an authenticator app (TOTP).
 * After that: enter the 6-digit code to reach aal2.
 */
export function MfaForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    (async () => {
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") {
        router.replace(next);
        return;
      }
      const { data: factors, error } = await sb.auth.mfa.listFactors();
      if (error) {
        setMode({ kind: "error", message: "Couldn't load your sign-in session. Please sign in again." });
        return;
      }
      const verified = factors.totp.find((f) => f.status === "verified");
      if (verified) {
        setMode({ kind: "verify", factorId: verified.id });
        return;
      }
      // Clear any half-finished enrolments, then start a fresh one.
      for (const f of factors.all.filter((f) => f.status === "unverified")) await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data: enrol, error: enrolError } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Jarvis ${new Date().toISOString().slice(0, 10)}` });
      if (enrolError || !enrol) {
        setMode({ kind: "error", message: "Couldn't start authenticator setup. Check MFA (TOTP) is enabled in Supabase." });
        return;
      }
      setMode({ kind: "enrol", factorId: enrol.id, qr: enrol.totp.qr_code, secret: enrol.totp.secret });
    })();
  }, [next, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mode.kind !== "verify" && mode.kind !== "enrol") return;
    setBusy(true);
    setError("");
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s+/g, "");
    const { error } = await supabaseBrowser().auth.mfa.challengeAndVerify({ factorId: mode.factorId, code });
    setBusy(false);
    if (error) {
      setError("That code didn't work. Codes change every 30 seconds — try the current one.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  if (mode.kind === "loading") return <p className="panel p-5 text-center text-muted">Checking…</p>;
  if (mode.kind === "error")
    return (
      <div className="panel space-y-4 p-5">
        <p className="text-sm text-danger">{mode.message}</p>
        <a href="/login" className="btn btn-ghost w-full">Back to sign-in</a>
      </div>
    );

  return (
    <form onSubmit={onSubmit} className="panel space-y-4 p-5">
      {mode.kind === "enrol" && (
        <div className="space-y-3">
          <p className="text-sm">Set up your authenticator app (e.g. Microsoft Authenticator, Google Authenticator or 1Password). Scan this code, then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mode.qr.startsWith("data:") ? mode.qr : `data:image/svg+xml;utf-8,${encodeURIComponent(mode.qr)}`} alt="Authenticator QR code" className="mx-auto h-48 w-48 rounded-lg bg-white p-2" />
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Can&apos;t scan? Enter this key instead</summary>
            <code className="mt-2 block break-all font-mono text-fg">{mode.secret}</code>
          </details>
        </div>
      )}
      <label className="block space-y-1.5">
        <span className="hud-label">6-digit code</span>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus className="input text-center font-mono text-xl tracking-[0.4em]" />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Verifying…" : mode.kind === "enrol" ? "Confirm and continue" : "Verify"}
      </button>
    </form>
  );
}
