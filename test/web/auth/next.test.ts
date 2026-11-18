import { describe, expect, it } from "vitest";
import { MAX_NEXT_LENGTH, safeNext } from "../../../src/web/auth/next";

describe("safeNext", () => {
  it.each([
    "/",
    "/servers",
    "/g/123456789012345678",
    "/g/1?tab=hikes&x=a%20b",
    "/a:b",
    "/path#part",
  ])("accepts the path %s", (path) => {
    expect(safeNext(path)).toBe(path);
  });

  it.each([
    ["missing", null],
    ["undefined", undefined],
    ["empty", ""],
    ["relative", "servers"],
    ["absolute https", "https://evil.example/"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,hi"],
    ["protocol-relative", "//evil.example"],
    ["protocol-relative with path", "//evil.example/servers"],
    ["slash then backslash", "/\\evil.example"],
    ["backslashes", "\\\\evil.example"],
    ["backslash later", "/servers\\x"],
    ["double slash later", "/servers//x"],
    ["encoded slash", "/%2F/evil.example"],
    ["encoded slashes", "/%2f%2fevil.example"],
    ["encoded backslash", "/%5Cevil.example"],
    ["encoded backslash later", "/a%5cb"],
    ["tab", "/\t/evil.example"],
    ["newline", "/servers\nSet-Cookie: x=1"],
    ["encoded newline", "/servers%0d%0aSet-Cookie:%20x=1"],
    ["space", "/ /evil.example"],
    ["bad percent-encoding", "/%E0%A4%A"],
    ["too long", `/${"a".repeat(MAX_NEXT_LENGTH)}`],
  ])("refuses %s", (_name, value) => {
    expect(safeNext(value)).toBeNull();
  });
});
