import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

function secret(name: "TOKEN_ENCRYPTION_KEY" | "NEXTAUTH_SECRET"): string {
  const s = process.env[name];
  if (!s || s.length < 16) throw new Error(`${name} is not set (or shorter than 16 characters).`);
  return s;
}

const key = (purpose: string, from: "TOKEN_ENCRYPTION_KEY" | "NEXTAUTH_SECRET") =>
  createHash("sha256").update(`${purpose}:${secret(from)}`).digest();

/** AES-256-GCM, so a token can't be read or altered without TOKEN_ENCRYPTION_KEY. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("qbo-token", "TOKEN_ENCRYPTION_KEY"), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(sealed: string): string {
  const [iv, tag, enc] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key("qbo-token", "TOKEN_ENCRYPTION_KEY"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

const sign = (body: string) => createHmac("sha256", key("oauth-state", "NEXTAUTH_SECRET")).update(body).digest("base64url");

/** Signed, short-lived OAuth `state` tying the Intuit callback to the user who started it. */
export function signState(payload: Record<string, string>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyState(state: string, maxAgeMs = 15 * 60 * 1000): Record<string, string> | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.ts !== "number" || Date.now() - payload.ts > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}
