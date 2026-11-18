import { describe, expect, it } from "vitest";
import { hexToBytes, verifyDiscordSignature } from "../../src/discord/verify";
import { createSigner, TIMESTAMP } from "../helpers";

const body = new TextEncoder().encode('{"type":1}');

describe("verifyDiscordSignature", () => {
  it("accepts a signature over timestamp + body", async () => {
    const signer = await createSigner();
    const signature = await signer.sign(TIMESTAMP, '{"type":1}');
    expect(
      await verifyDiscordSignature(
        signer.publicKeyHex,
        signature,
        TIMESTAMP,
        body,
      ),
    ).toBe(true);
  });

  it("rejects a signature made with another key", async () => {
    const signer = await createSigner();
    const other = await createSigner();
    const signature = await other.sign(TIMESTAMP, '{"type":1}');
    expect(
      await verifyDiscordSignature(
        signer.publicKeyHex,
        signature,
        TIMESTAMP,
        body,
      ),
    ).toBe(false);
  });

  it("rejects a different timestamp", async () => {
    const signer = await createSigner();
    const signature = await signer.sign(TIMESTAMP, '{"type":1}');
    expect(
      await verifyDiscordSignature(
        signer.publicKeyHex,
        signature,
        "1700000001",
        body,
      ),
    ).toBe(false);
  });

  it("rejects malformed hex and wrong lengths", async () => {
    const signer = await createSigner();
    const signature = await signer.sign(TIMESTAMP, '{"type":1}');
    const cases: [string, string][] = [
      [signer.publicKeyHex, "zz" + signature.slice(2)],
      [signer.publicKeyHex, signature.slice(1)],
      [signer.publicKeyHex, signature.slice(2)],
      [signer.publicKeyHex, ""],
      ["not hex", signature],
      [signer.publicKeyHex.slice(2), signature],
    ];
    for (const [key, sig] of cases) {
      expect(await verifyDiscordSignature(key, sig, TIMESTAMP, body)).toBe(
        false,
      );
    }
  });
});

describe("hexToBytes", () => {
  it("decodes hex in either case", () => {
    expect(hexToBytes("00ffA0")).toEqual(new Uint8Array([0, 255, 160]));
  });

  it("rejects odd lengths and non-hex characters", () => {
    expect(hexToBytes("abc")).toBeNull();
    expect(hexToBytes("0g")).toBeNull();
  });
});
