import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for sensitive vault fields (UTR, bank details) and,
 * later, Xero / Microsoft refresh tokens. Format: v1.<iv>.<tag>.<ciphertext>
 * (each part base64url). The key never leaves the server.
 */

const VERSION = "v1";

function loadKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) {
    throw new Error("VAULT_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  }
  return key;
}

export function encrypt(plaintext: string, keyB64: string): string {
  const key = loadKey(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decrypt(payload: string, keyB64: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error("Unrecognised encrypted value format.");
  }
  const key = loadKey(keyB64);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}

/** Mask all but the last `visible` characters, e.g. "1234567890" → "••••••7890". */
export function mask(value: string, visible = 4): string {
  const compact = value.replace(/[\s-]+/g, "");
  if (compact.length <= visible) return "•".repeat(compact.length);
  return "•".repeat(Math.min(compact.length - visible, 8)) + compact.slice(-visible);
}
