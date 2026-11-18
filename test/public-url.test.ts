import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { absoluteUrl } from "../src/public-url";

describe("absoluteUrl", () => {
  it("puts a path on the configured origin", () => {
    expect(absoluteUrl(env, "/calendar/abc.ics")).toBe(
      "https://hikebot.example/calendar/abc.ics",
    );
  });

  it("ignores a trailing slash on PUBLIC_URL", () => {
    for (const base of [
      "https://hiking.bitcru.sh",
      "https://hiking.bitcru.sh/",
    ]) {
      expect(absoluteUrl({ PUBLIC_URL: base }, "/auth/callback")).toBe(
        "https://hiking.bitcru.sh/auth/callback",
      );
    }
  });

  it("keeps a query and a fragment", () => {
    expect(
      absoluteUrl({ PUBLIC_URL: "https://hiking.bitcru.sh" }, "/a?b=c d#e"),
    ).toBe("https://hiking.bitcru.sh/a?b=c%20d#e");
  });

  it("returns the origin's root for /", () => {
    expect(absoluteUrl({ PUBLIC_URL: "https://hiking.bitcru.sh/" }, "/")).toBe(
      "https://hiking.bitcru.sh/",
    );
  });

  it.each([
    "calendar",
    "//evil.example/x",
    "https://evil.example/",
    "",
    "/\\evil.example/x",
    "/\t/evil.example/x",
    "/\n/evil.example",
    "/\r/evil.example",
    "/a\u0000b",
  ])("refuses %j, which is not a path from the root", (path) => {
    expect(() =>
      absoluteUrl({ PUBLIC_URL: "https://hiking.bitcru.sh" }, path),
    ).toThrow(/single "\/"/);
  });
});
