/**
 * Signs values and seals expiring tokens with HMAC-SHA256 over
 * `SIGNING_SECRET`, using WebCrypto only. Every signature is bound to a
 * `Purpose`, so a value signed for one use (a session cookie, say) never
 * verifies for another (a calendar address). Functions that read the clock
 * take it as an argument. docs/design.md, "Signing", says what is signed
 * with which purpose.
 */

/** What a signature is for. Add a member for each new use. */
export type Purpose =
  "session" | "oauth-state" | "csrf" | "calendar" | "notice" | "flash";

/** The shortest `SIGNING_SECRET` accepted, in characters. */
export const MIN_SECRET_LENGTH = 32;

/** Bytes in an HMAC-SHA256 signature. */
const SIGNATURE_BYTES = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

/**
 * Returns the base64url HMAC-SHA256 signature of `message` for `purpose`.
 * Throws if `secret` is shorter than MIN_SECRET_LENGTH.
 */
export async function sign(
  secret: string,
  purpose: Purpose,
  message: string,
): Promise<string> {
  const key = await importKey(secret);
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    signedBytes(purpose, message),
  );
  return toBase64Url(new Uint8Array(mac));
}

/**
 * Whether `signature` is `sign(secret, purpose, message)`, compared in
 * constant time. Returns false for a signature that is not canonical
 * base64url of 32 bytes. Throws if `secret` is shorter than
 * MIN_SECRET_LENGTH.
 */
export async function verify(
  secret: string,
  purpose: Purpose,
  message: string,
  signature: string,
): Promise<boolean> {
  const key = await importKey(secret);
  const mac = fromBase64Url(signature);
  if (mac?.length !== SIGNATURE_BYTES) return false;
  return crypto.subtle.verify("HMAC", key, mac, signedBytes(purpose, message));
}

/**
 * Returns a token `<payload>.<signature>` carrying `payload` as JSON until
 * `expiresAt` (milliseconds since the epoch), signed for `purpose`. The
 * payload is readable by whoever holds the token; it is only protected from
 * change. Throws if `secret` is shorter than MIN_SECRET_LENGTH.
 */
export async function seal(
  secret: string,
  purpose: Purpose,
  payload: unknown,
  expiresAt: number,
): Promise<string> {
  if (!Number.isFinite(expiresAt)) {
    throw new RangeError("expiresAt must be a finite number of milliseconds");
  }
  if (payload === undefined) {
    throw new TypeError("payload must be a JSON value, not undefined");
  }
  const body = toBase64Url(
    encoder.encode(JSON.stringify({ exp: expiresAt, data: payload })),
  );
  return `${body}.${await sign(secret, purpose, body)}`;
}

/**
 * Returns the payload of a token from `seal(secret, purpose, …)`, or null
 * when the token is malformed, was sealed with another secret or for another
 * purpose, was changed, or `now` (milliseconds since the epoch) is at or past
 * its expiry. The type parameter is what the caller sealed; the signature
 * proves this Worker made the token, so the payload is not re-validated.
 * Throws if `secret` is shorter than MIN_SECRET_LENGTH.
 */
export async function open<T = unknown>(
  secret: string,
  purpose: Purpose,
  token: string,
  now: number,
): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body = "", signature = ""] = parts;
  if (!(await verify(secret, purpose, body, signature))) return null;
  const bytes = fromBase64Url(body);
  if (!bytes) return null;
  let sealed: unknown;
  try {
    sealed = JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
  if (typeof sealed !== "object" || sealed === null || !("data" in sealed)) {
    return null;
  }
  const { exp, data } = sealed as { exp: unknown; data: unknown };
  if (typeof exp !== "number" || !(now < exp)) return null;
  return data as T;
}

function importKey(secret: string): Promise<CryptoKey> {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SIGNING_SECRET must be at least ${String(MIN_SECRET_LENGTH)} characters long`,
    );
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * The bytes a signature covers: the purpose, a NUL, then the message. No
 * purpose contains a NUL, so the first NUL ends the purpose and no two
 * (purpose, message) pairs give the same bytes.
 */
function signedBytes(purpose: Purpose, message: string): Uint8Array {
  return encoder.encode(`${purpose}\u0000${message}`);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/**
 * Decodes unpadded base64url, or returns null when `text` is not its
 * canonical form (other characters, padding, or unused bits set), so each
 * byte string has exactly one accepted encoding.
 */
function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return toBase64Url(bytes) === text ? bytes : null;
}
