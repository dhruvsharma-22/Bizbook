import { createHash, randomBytes } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createPaymentCheckoutLinkToken(): { token: string; tokenSha256: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenSha256: createHash("sha256").update(token, "utf8").digest("hex") };
}

/** Accept only canonical 256-bit base64url tokens before hashing. */
export function hashPaymentCheckoutLinkToken(value: unknown): string | null {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value) return null;
  return createHash("sha256").update(value, "utf8").digest("hex");
}
