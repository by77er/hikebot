import { describe, expect, it } from "vitest";
import {
  Avatar,
  initials,
  serverIconUrl,
  userAvatarUrl,
} from "../../../src/web/components/avatar";
import { render, spokenText } from "./render";

const PICTURE = "https://cdn.discordapp.com/avatars/1/abc.png?size=128";

describe("Avatar", () => {
  it("draws the initial behind the picture, hidden from screen readers next to the name", async () => {
    const html = render(<Avatar name="Ana Hiker" src={PICTURE} />);
    expect(html).toBe(
      `<span class="avatar" aria-hidden="true"><span class="avatar__initials">A</span><img class="avatar__image" data-initials="A" src="${PICTURE}" alt width="48" height="48" decoding="async" referrerpolicy="no-referrer"/></span>`,
    );
    expect(await spokenText(`${html} Ana Hiker`)).toBe("Ana Hiker");
  });

  it("shows only the initial when there is no picture", async () => {
    const html = render(<Avatar name="ana" src={null} size="small" />);
    expect(html).toBe(
      '<span class="avatar avatar--small" aria-hidden="true"><span class="avatar__initials">A</span></span>',
    );
    expect(html).not.toContain("<img");
    expect(await spokenText(html)).toBe("");
  });

  it("draws a server as a rounded square with two initials", () => {
    const html = render(
      <Avatar name="Lake Loop Trail Runners" src={null} shape="square" />,
    );
    expect(html).toBe(
      '<span class="avatar avatar--square" aria-hidden="true"><span class="avatar__initials">LL</span></span>',
    );
  });

  it("is an image named by its label where no name is beside it", async () => {
    const html = render(
      <Avatar name="Ridge Walkers" src={null} label="Ridge Walkers" />,
    );
    expect(html).toContain('role="img" aria-label="Ridge Walkers"');
    expect(html).not.toContain("aria-hidden");
    expect(await spokenText(html)).toBe("Ridge Walkers R");
  });

  it("shows a name holding markup as text", () => {
    const html = render(<Avatar name="<b>x</b>" src={null} />);
    expect(html).not.toContain("<b>");
  });
});

describe("initials", () => {
  it.each([
    ["Ana Hiker", 1, "A"],
    ["Ana Hiker", 2, "AH"],
    ["moss & mountains", 2, "MM"],
    ["  Łódź   hikers ", 2, "ŁH"],
    ["Hiking club 01", 3, "HC0"],
    ["!!!", 2, "?"],
    ["", 1, "?"],
  ])("%j, %i letters: %s", (name, count, expected) => {
    expect(initials(name, count)).toBe(expected);
  });
});

describe("Discord picture addresses", () => {
  it("builds the CDN address at twice the drawn size", () => {
    expect(userAvatarUrl("1", "abc")).toBe(
      "https://cdn.discordapp.com/avatars/1/abc.png?size=128",
    );
    expect(userAvatarUrl("1", "abc", "small")).toBe(
      "https://cdn.discordapp.com/avatars/1/abc.png?size=64",
    );
    expect(serverIconUrl("2", "def")).toBe(
      "https://cdn.discordapp.com/icons/2/def.png?size=128",
    );
  });

  it("has none without a hash", () => {
    expect(userAvatarUrl("1", null)).toBeNull();
    expect(serverIconUrl("2", null)).toBeNull();
  });
});
