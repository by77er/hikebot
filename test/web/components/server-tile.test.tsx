import { describe, expect, it } from "vitest";
import {
  ServerTile,
  ServerTileList,
} from "../../../src/web/components/server-tile";
import { render, spokenText } from "./render";

const LONG_NAME =
  `Hiking club 01 ${"of the long and winding mountain trails ".repeat(3)}`.slice(
    0,
    100,
  );

describe("ServerTile", () => {
  it("is one link to the server's page, named by the server's name", async () => {
    const html = render(
      <ServerTile
        server={{
          id: "200000000000000001",
          name: "Ridge Walkers",
          icon: "abc",
        }}
      />,
    );
    expect(html).toMatch(
      /^<a class="server-tile" href="\/g\/200000000000000001"><span class="avatar avatar--square server-tile__icon" aria-hidden="true"><span class="avatar__initials">RW<\/span><img class="avatar__image" data-initials="RW" src="https:\/\/cdn\.discordapp\.com\/icons\/200000000000000001\/abc\.png\?size=128" alt /,
    );
    expect(html).toContain(
      '<span class="server-tile__name">Ridge Walkers</span>',
    );
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(await spokenText(html)).toBe("Ridge Walkers");
  });

  it("shows initials for a server without an icon", async () => {
    const html = render(
      <ServerTile server={{ id: "2", name: "Lake Loop", icon: null }} />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain('<span class="avatar__initials">LL</span>');
    expect(await spokenText(html)).toBe("Lake Loop");
  });

  it("keeps a 100-character name whole in the markup, for the stylesheet to clamp", async () => {
    const html = render(
      <ServerTile server={{ id: "3", name: LONG_NAME, icon: null }} />,
    );
    expect(LONG_NAME).toHaveLength(100);
    expect(html).toContain(
      `<span class="server-tile__name">${LONG_NAME}</span>`,
    );
    expect(await spokenText(html)).toBe(LONG_NAME);
  });

  it("shows a name holding markup as text", () => {
    const html = render(
      <ServerTile
        server={{ id: "4", name: "<script>alert(1)</script>", icon: null }}
      />,
    );
    expect(html).not.toContain("<script>");
  });

  it("takes another address and a previewed state for the style guide", () => {
    expect(
      render(
        <ServerTile
          server={{ id: "5", name: "Ridge", icon: null }}
          href="/styleguide#server-tile"
          preview="hover"
        />,
      ),
    ).toMatch(
      /^<a class="server-tile" href="\/styleguide#server-tile" data-preview="hover">/,
    );
  });
});

describe("ServerTileList", () => {
  it("lists one tile per server, in order", async () => {
    const html = render(
      <ServerTileList
        servers={[
          { id: "1", name: "Alpine Club", icon: null },
          { id: "2", name: "Ridge Walkers", icon: null },
        ]}
      />,
    );
    expect(html).toMatch(/^<ul class="server-tile-list list-reset"><li>/);
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(await spokenText(html)).toBe("Alpine Club Ridge Walkers");
  });
});
