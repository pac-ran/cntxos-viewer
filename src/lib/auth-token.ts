/**
 * Operator auth token — HMAC-SHA256 signed cookie value.
 * Token format: "<slug>:<base64url(hmac)>"
 * Requires AUTH_SECRET env var (same value as cntxos AUTH_SECRET).
 */

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function getKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage
  );
}

export async function verifyOperatorToken(token: string): Promise<string | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const sep = token.lastIndexOf(":");
  if (sep < 1) return null;
  const slug = token.slice(0, sep);
  const sigStr = token.slice(sep + 1);
  try {
    const key = await getKey(secret, ["verify"]);
    const sigBytes = fromBase64Url(sigStr);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes.buffer as ArrayBuffer,
      encoder.encode(slug)
    );
    return valid ? slug : null;
  } catch {
    return null;
  }
}
