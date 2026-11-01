import "server-only";
import { cookies } from "next/headers";
import { encrypt, decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";

/** Short-lived, encrypted cookie holding OAuth state + PKCE verifier during a connect flow. */

export async function setOAuthCookie(provider: string, value: { state: string; verifier: string; ownerId: string }) {
  (await cookies()).set(`jarvis_oauth_${provider}`, encrypt(JSON.stringify({ ...value, at: Date.now() }), env.vaultKey()), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: `/api/integrations/${provider}`,
    maxAge: 600,
  });
}

export async function takeOAuthCookie(provider: string): Promise<{ state: string; verifier: string; ownerId: string } | null> {
  const store = await cookies();
  const raw = store.get(`jarvis_oauth_${provider}`)?.value;
  store.delete({ name: `jarvis_oauth_${provider}`, path: `/api/integrations/${provider}` });
  if (!raw) return null;
  try {
    const v = JSON.parse(decrypt(raw, env.vaultKey()));
    if (Date.now() - v.at > 600_000) return null;
    return v;
  } catch {
    return null;
  }
}
