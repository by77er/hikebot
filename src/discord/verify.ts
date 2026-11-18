const encoder = new TextEncoder();

/** Decodes an even-length hex string, or returns null if it is not one. */
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Checks Discord's request signature: an Ed25519 signature (hex) over the
 * timestamp header followed by the raw request body, made with the
 * application's key (`publicKeyHex`). Any malformed input verifies as false.
 */
export async function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  body: Uint8Array,
): Promise<boolean> {
  const publicKey = hexToBytes(publicKeyHex);
  const signature = hexToBytes(signatureHex);
  if (publicKey?.length !== 32 || signature?.length !== 64) {
    return false;
  }

  const timestampBytes = encoder.encode(timestamp);
  const message = new Uint8Array(timestampBytes.length + body.length);
  message.set(timestampBytes);
  message.set(body, timestampBytes.length);

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      publicKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify("Ed25519", key, signature, message);
  } catch {
    return false;
  }
}
