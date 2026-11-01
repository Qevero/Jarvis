"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/safe-next";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState(params.get("error") === "not_allowed" ? "That account isn't allowed to use Jarvis." : "");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setBusy(false);
    if (error) {
      setError("Sign-in failed. Check your email and password.");
      return;
    }
    router.replace(`/mfa?next=${encodeURIComponent(next)}`);
  }

  return (
    <form onSubmit={onSubmit} className="panel space-y-4 p-5">
      <label className="block space-y-1.5">
        <span className="hud-label">Email</span>
        <input name="email" type="email" autoComplete="username" required className="input" />
      </label>
      <label className="block space-y-1.5">
        <span className="hud-label">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className="input" />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
