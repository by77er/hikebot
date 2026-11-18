import { describe, expect, it } from "vitest";
import { open, seal, sign, verify, type Purpose } from "../src/signing";

const SECRET = "0123456789abcdef0123456789abcdef";
const OTHER_SECRET = "fedcba9876543210fedcba9876543210";
const NOW = Date.UTC(2026, 10, 18, 12);
const HOUR = 60 * 60 * 1000;

/** Replaces the character at `index` with another base64url character. */
function flip(text: string, index: number): string {
  const char = text.charAt(index) === "A" ? "B" : "A";
  return text.slice(0, index) + char + text.slice(index + 1);
}

describe("sign and verify", () => {
  it("matches HMAC-SHA256 over the purpose, a NUL and the message", async () => {
    // From Node: createHmac("sha256", SECRET).update("session\0hike 42").digest("base64url")
    expect(await sign(SECRET, "session", "hike 42")).toBe(
      "99jtEVsCiNwRC3WbxXZLy6DQ0S0O-z2qqQ_0nI5ftOQ",
    );
  });

  it("verifies a signature for the same purpose and message", async () => {
    const signature = await sign(SECRET, "calendar", "guild 7");
    expect(await verify(SECRET, "calendar", "guild 7", signature)).toBe(true);
  });

  it("rejects a signature made for another purpose", async () => {
    const signature = await sign(SECRET, "session", "user 1");
    for (const purpose of ["oauth-state", "csrf", "calendar"] as const) {
      expect(await verify(SECRET, purpose, "user 1", signature)).toBe(false);
    }
  });

  it("rejects a signature made for another message", async () => {
    const signature = await sign(SECRET, "session", "user 1");
    expect(await verify(SECRET, "session", "user 2", signature)).toBe(false);
  });

  it("rejects a signature made with another secret", async () => {
    const signature = await sign(OTHER_SECRET, "session", "user 1");
    expect(await verify(SECRET, "session", "user 1", signature)).toBe(false);
  });

  it("keeps the purpose and the message apart", async () => {
    // A NUL in the message cannot move where the purpose ends.
    const signature = await sign(SECRET, "csrf", "\u0000x");
    expect(await verify(SECRET, "csrf", "x", signature)).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["truncated", "99jtEVsCiNwRC3WbxXZLy6DQ0S0O-z2qqQ_0nI5ft"],
    ["not base64url", "99jtEVsCiNwRC3WbxXZLy6DQ0S0O+z2qqQ/0nI5ftOQ"],
    ["padded", "99jtEVsCiNwRC3WbxXZLy6DQ0S0O-z2qqQ_0nI5ftOQ="],
    [
      "non-canonical last character",
      "99jtEVsCiNwRC3WbxXZLy6DQ0S0O-z2qqQ_0nI5ftOR",
    ],
    ["too long", "99jtEVsCiNwRC3WbxXZLy6DQ0S0O-z2qqQ_0nI5ftOQAAAA"],
    ["one character", "A"],
    ["not ASCII", "é".repeat(43)],
  ])("returns false for a signature that is %s", async (_, signature) => {
    await expect(verify(SECRET, "session", "hike 42", signature)).resolves.toBe(
      false,
    );
  });

  it("does not typecheck a purpose outside the union", async () => {
    // @ts-expect-error "login" is not a Purpose.
    const signature = await sign(SECRET, "login", "x");
    const name: string = "session";
    // @ts-expect-error a plain string is not a Purpose.
    const purpose: Purpose = name;
    expect(await verify(SECRET, purpose, "x", signature)).toBe(false);
  });
});

describe("a secret that is too short", () => {
  const short = "tooshort-secret-of-31-character";

  it.each([
    ["sign", () => sign(short, "session", "x")],
    ["verify", () => verify(short, "session", "x", "")],
    ["seal", () => seal(short, "session", 1, NOW + HOUR)],
    ["open", () => open(short, "session", "a.b", NOW)],
  ])("makes %s throw naming SIGNING_SECRET, not its value", async (_, call) => {
    const error = await call().then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("SIGNING_SECRET");
    expect(message).not.toContain(short);
    expect(short).toHaveLength(31);
  });

  it("accepts a secret of exactly 32 characters", async () => {
    await expect(sign("x".repeat(32), "session", "x")).resolves.toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  });
});

describe("seal and open", () => {
  const payload = { user: "123456789012345678", name: "Ålesund", tags: [1, 2] };

  it("round-trips a JSON payload before its expiry", async () => {
    const token = await seal(SECRET, "session", payload, NOW + HOUR);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(await open(SECRET, "session", token, NOW)).toEqual(payload);
    expect(await open(SECRET, "session", token, NOW + HOUR - 1)).toEqual(
      payload,
    );
  });

  it("round-trips null, a string and a number", async () => {
    for (const value of [null, "state", 0]) {
      const token = await seal(SECRET, "oauth-state", value, NOW + HOUR);
      expect(await open(SECRET, "oauth-state", token, NOW)).toEqual(value);
    }
  });

  it("returns null at and past the expiry", async () => {
    const token = await seal(SECRET, "session", payload, NOW + HOUR);
    expect(await open(SECRET, "session", token, NOW + HOUR)).toBeNull();
    expect(await open(SECRET, "session", token, NOW + 2 * HOUR)).toBeNull();
  });

  it("returns null for a token sealed for another purpose", async () => {
    const token = await seal(SECRET, "session", payload, NOW + HOUR);
    expect(await open(SECRET, "csrf", token, NOW)).toBeNull();
    expect(await open(SECRET, "calendar", token, NOW)).toBeNull();
  });

  it("returns null for a token sealed with another secret", async () => {
    const token = await seal(OTHER_SECRET, "session", payload, NOW + HOUR);
    expect(await open(SECRET, "session", token, NOW)).toBeNull();
  });

  it("returns null for a tampered payload", async () => {
    const token = await seal(SECRET, "session", payload, NOW + HOUR);
    const [body = "", signature = ""] = token.split(".");
    expect(
      await open(SECRET, "session", `${flip(body, 5)}.${signature}`, NOW),
    ).toBeNull();
    // A payload re-encoded with a later expiry, keeping the old signature.
    const longer = btoa(
      JSON.stringify({ exp: NOW + 100 * HOUR, data: payload }),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    expect(
      await open(SECRET, "session", `${longer}.${signature}`, NOW),
    ).toBeNull();
  });

  it("returns null for a tampered signature", async () => {
    const token = await seal(SECRET, "session", payload, NOW + HOUR);
    const [body = "", signature = ""] = token.split(".");
    for (const index of [0, 20, 42]) {
      expect(
        await open(SECRET, "session", `${body}.${flip(signature, index)}`, NOW),
      ).toBeNull();
    }
  });

  it.each([
    ["empty", ""],
    ["a single part", "abc"],
    ["three parts", "a.b.c"],
    ["an empty signature", "eyJleHAiOjF9."],
    ["not base64url", "!!!.???"],
  ])("returns null for a malformed token: %s", async (_, token) => {
    await expect(open(SECRET, "session", token, NOW)).resolves.toBeNull();
  });

  it("returns null for a signed body that is not a sealed payload", async () => {
    for (const json of [
      "not json",
      "[1]",
      '{"exp":"soon","data":1}',
      '{"exp":9e15}',
    ]) {
      const body = btoa(json)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
      const token = `${body}.${await sign(SECRET, "session", body)}`;
      expect(await open(SECRET, "session", token, NOW)).toBeNull();
    }
  });

  it("refuses to seal undefined or an expiry that is not a number", async () => {
    await expect(seal(SECRET, "session", undefined, NOW)).rejects.toThrow(
      TypeError,
    );
    await expect(seal(SECRET, "session", 1, Number.NaN)).rejects.toThrow(
      RangeError,
    );
  });
});
