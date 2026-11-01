import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, mask } from "@/lib/crypto";

const key = randomBytes(32).toString("base64");

describe("encrypt / decrypt", () => {
  it("round-trips a value", () => {
    const ct = encrypt("1234567890", key);
    expect(ct).toMatch(/^v1\./);
    expect(ct).not.toContain("1234567890");
    expect(decrypt(ct, key)).toBe("1234567890");
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("rejects tampered ciphertext", () => {
    const ct = encrypt("secret", key);
    const parts = ct.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const ct = encrypt("secret", key);
    expect(() => decrypt(ct, randomBytes(32).toString("base64"))).toThrow();
  });

  it("requires a 32-byte key", () => {
    expect(() => encrypt("x", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("mask", () => {
  it("shows only the last four characters", () => {
    expect(mask("1234567890")).toBe("••••••7890");
    expect(mask("12-34-56")).toBe("••3456");
  });
  it("masks short values entirely", () => {
    expect(mask("123")).toBe("•••");
  });
});
