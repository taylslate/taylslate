import { describe, expect, it } from "vitest";
import { decryptString, encryptString, openJson, sealJson, sha256Hex } from "./crypto";

const key = Buffer.alloc(32, 7);
const other = Buffer.alloc(32, 8);
const plain = "plain text token value should not leak";

describe("youtube token crypto", () => {
  it("round trips and never puts the plaintext in the sealed value", () => {
    const sealed = encryptString(plain, key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed.split(".")).toHaveLength(4);
    expect(sealed).not.toContain(plain);
    expect(decryptString(sealed, key)).toBe(plain);
  });

  it("rejects a tampered tag, IV, version, or the wrong key", () => {
    const sealed = encryptString(plain, key);
    const [version, iv, tag, ciphertext] = sealed.split(".");
    const flip = (value: string) => (value.startsWith("A") ? `B${value.slice(1)}` : `A${value.slice(1)}`);
    expect(() => decryptString(`${version}.${iv}.${flip(tag)}.${ciphertext}`, key)).toThrow("decrypt failed");
    expect(() => decryptString(`${version}.${flip(iv)}.${tag}.${ciphertext}`, key)).toThrow("decrypt failed");
    expect(() => decryptString(`v2.${iv}.${tag}.${ciphertext}`, key)).toThrow("decrypt failed");
    expect(() => decryptString(sealed, other)).toThrow("decrypt failed");
    expect(() => decryptString(sealed, other)).toThrow(/^decrypt failed$/);
  });

  it("opens a sealed cookie payload and rejects a bad seal", () => {
    const payload = {
      state_hash: sha256Hex("state"),
      verifier: "verifier",
      user_id: "11111111-1111-4111-8111-111111111111",
      issued_at: 1,
    };
    const sealed = sealJson(payload, key);
    expect(openJson(sealed, key)).toEqual(payload);
    expect(openJson(sealed, other)).toBeNull();
    expect(openJson("v1.not.a.cookie", key)).toBeNull();
  });
});
