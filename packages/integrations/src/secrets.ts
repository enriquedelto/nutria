/** AES-256-GCM encryption for credentials and private files, HMAC helpers, token hashing. */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY no está definida (32 bytes en base64)");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("APP_ENCRYPTION_KEY debe tener 32 bytes en base64");
  return k;
}

/** Encrypt → "v1.<iv>.<tag>.<ciphertext>" (base64url). */
export function encrypt(plain: string | Buffer, k: Buffer = key()): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([c.update(typeof plain === "string" ? Buffer.from(plain, "utf8") : plain), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptBuffer(token: string, k: Buffer = key()): Buffer {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || data == null) throw new Error("Formato cifrado no válido");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]);
}

export const decrypt = (token: string, k?: Buffer) => decryptBuffer(token, k).toString("utf8");

export function encryptJson(obj: unknown, k?: Buffer): string {
  return encrypt(JSON.stringify(obj), k);
}
export function decryptJson<T>(token: string, k?: Buffer): T {
  return JSON.parse(decrypt(token, k)) as T;
}

/** Binary file encryption: [12 iv][16 tag][ciphertext] */
export function encryptFile(buf: Buffer, k: Buffer = key()): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}
export function decryptFile(buf: Buffer, k: Buffer = key()): Buffer {
  const d = createDecipheriv("aes-256-gcm", k, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Random token with a readable prefix, e.g. "ntr_live_xxx". Store only sha256(token). */
export function newToken(prefix = "ntr"): { token: string; hash: string; prefix: string } {
  const token = `${prefix}_${randomBytes(24).toString("base64url")}`;
  return { token, hash: sha256(token), prefix: token.slice(0, prefix.length + 7) };
}

export function hmacSha256(secret: string, payload: string | Buffer, encoding: "hex" | "base64url" = "hex"): string {
  return createHmac("sha256", secret).update(payload).digest(encoding);
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Verify "sha256=<hex>" style signatures (GitHub-like) or bare hex/base64url. */
export function verifySignature(secret: string, body: string | Buffer, header: string | null | undefined): boolean {
  if (!header) return false;
  const sig = header.replace(/^sha256=/, "").trim();
  return safeEqual(sig, hmacSha256(secret, body, "hex")) || safeEqual(sig, hmacSha256(secret, body, "base64url"));
}
