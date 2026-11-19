import { describe, expect, it } from "vitest";
import { AppHeader } from "../../../src/web/components/app-header";
import { render, spokenText } from "./render";

const ANA = {
  name: "Ana Hiker",
  avatar: "https://cdn.discordapp.com/avatars/1/abc.png?size=64",
  csrf: "token.signature",
};

describe("AppHeader", () => {
  it("signed out, is the brand mark linking home and nothing else", async () => {
    const html = render(<AppHeader />);
    expect(html).toBe(
      '<header class="shell__header"><div class="shell__inner app-header__inner"><a class="shell__brand" href="/"><span class="blaze" aria-hidden="true"></span>hikebot</a></div></header>',
    );
    expect(await spokenText(html)).toBe("hikebot");
  });

  it("signed in, has a menu named by the user that holds Sign out", async () => {
    const html = render(<AppHeader user={ANA} />);
    expect(html).toContain(
      '<details class="app-header__menu"><summary class="app-header__summary">',
    );
    expect(html).toContain(
      '<span class="avatar avatar--small" aria-hidden="true"><span class="avatar__initials">A</span><img class="avatar__image"',
    );
    expect(html).toContain('<span class="app-header__name">Ana Hiker</span>');
    expect(html).toContain(
      '<p class="app-header__signed-in">Signed in as Ana Hiker.</p>',
    );
    const summary = /<summary[^>]*>(.*)<\/summary>/.exec(html)?.[1] ?? "";
    expect(await spokenText(summary)).toBe("Your account: Ana Hiker");
    expect(await spokenText(html)).toBe(
      "hikebot Your account: Ana Hiker Signed in as Ana Hiker. Sign out",
    );
  });

  it("signs out with a form posting the CSRF token to /logout", () => {
    const html = render(<AppHeader user={ANA} />);
    expect(html).toContain(
      '<form method="post" action="/logout"><input type="hidden" name="csrf" value="token.signature"/><button class="button button--quiet" type="submit"><span>Sign out</span></button></form>',
    );
  });

  it("shows the initial when the user has no avatar", () => {
    const html = render(<AppHeader user={{ ...ANA, avatar: null }} />);
    expect(html).toContain(
      '<span class="avatar avatar--small" aria-hidden="true"><span class="avatar__initials">A</span></span>',
    );
  });

  it("has room for the server and the navigation", async () => {
    const html = render(
      <AppHeader
        user={ANA}
        context="Ridge Walkers"
        nav={
          <ul>
            <li>
              <a href="/g/1" aria-current="page">
                Hikes
              </a>
            </li>
          </ul>
        }
      />,
    );
    expect(html).toContain('<p class="app-header__context">Ridge Walkers</p>');
    expect(html).toContain(
      '<nav class="shell__nav app-header__nav" aria-label="Main"><ul>',
    );
    expect(await spokenText(html)).toMatch(
      /^hikebot Ridge Walkers Main Hikes /,
    );
  });

  it("shows a name holding markup as text", () => {
    const html = render(
      <AppHeader user={{ ...ANA, name: "<script>alert(1)</script>" }} />,
    );
    expect(html).not.toContain("<script>");
  });

  it("opens the menu and previews its button's states for the style guide", () => {
    expect(render(<AppHeader user={ANA} open preview="focus" />)).toContain(
      '<details class="app-header__menu" open><summary class="app-header__summary" data-preview="focus">',
    );
  });
});
