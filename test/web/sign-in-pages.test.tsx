import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sessionCookie, type Session } from "../../src/web/auth/session";
import { INVITE_PERMISSIONS, inviteUrl } from "../../src/web/invite";
import { SignInCancelledPage } from "../../src/web/pages/sign-in-cancelled";
import { htmlResponse } from "../../src/web/response";
import { webRouter } from "../../src/web/routes";
import { outline } from "./helpers";

const ana: Session = {
  userId: "400000000000000001",
  name: "Ana Hiker",
  avatar: "abc",
  guilds: [
    { id: "200000000000000001", name: "Alpine Club", icon: "def" },
    { id: "200000000000000002", name: "Ridge Walkers", icon: null },
  ],
  issuedAt: Date.now(),
};

async function page(path: string, session?: Session): Promise<string> {
  const headers: Record<string, string> = {};
  if (session) {
    headers.Cookie = (await sessionCookie(env, session)).split(";")[0] ?? "";
  }
  const response = await webRouter.handle(
    new Request(`https://hikebot.example${path}`, { headers }),
    env,
    createExecutionContext(),
  );
  expect(response.status).toBe(200);
  return response.text();
}

/** The levels of the page's headings, in order. */
function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])\b/g)].map(([, level]) => Number(level));
}

/** Checks one h1 first, and no heading more than one level below the last. */
function expectHeadingsInOrder(html: string): void {
  const levels = headingLevels(html);
  expect(levels[0]).toBe(1);
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  for (const [index, level] of levels.entries()) {
    if (index > 0)
      expect(level).toBeLessThanOrEqual((levels[index - 1] ?? 1) + 1);
  }
}

function primaryButtons(html: string): string[] {
  return [
    ...html.matchAll(/<a class="button button--primary[^"]*"[^>]*>/g),
  ].map(([tag]) => tag);
}

describe("the landing page, signed out", () => {
  it("has its headings in order and one primary action, Sign in with Discord", async () => {
    const html = await page("/");
    expectHeadingsInOrder(html);
    expect(headingLevels(html)).toEqual([1, 2, 3, 3, 3, 2]);
    expect(primaryButtons(html)).toEqual([
      '<a class="button button--primary" href="/login">',
    ]);
    expect(html).toContain("discord-sign-in__mark");
  });

  it("offers adding the bot to a server as a quiet secondary", async () => {
    const html = await page("/");
    const href = inviteUrl(env).replaceAll("&", "&amp;");
    expect(html).toContain(`<a class="button button--quiet" href="${href}">`);
    expect((await outline(html)).text).toContain("Add hikebot to a server");
  });
});

describe("the server list", () => {
  it("has its headings in order, a tile per server and no primary action", async () => {
    const html = await page("/servers", ana);
    expectHeadingsInOrder(html);
    expect(headingLevels(html)).toEqual([1]);
    expect(primaryButtons(html)).toEqual([]);
    expect(html.match(/<a class="server-tile" href="\/g\/\d+">/g)).toEqual([
      '<a class="server-tile" href="/g/200000000000000001">',
      '<a class="server-tile" href="/g/200000000000000002">',
    ]);
    const text = (await outline(html)).text;
    expect(text).toContain("Choose a server");
    expect(text).toContain("This list is from when you signed in.");
  });

  it("shows the user's avatar and name in the header's menu", async () => {
    const html = await page("/servers", ana);
    expect(html).toContain(
      'src="https://cdn.discordapp.com/avatars/400000000000000001/abc.png?size=64"',
    );
    expect(html).toContain('<span class="app-header__name">Ana Hiker</span>');
    expect(html).toContain('<form method="post" action="/logout">');
  });

  it("explains the no-servers state with a way to add hikebot", async () => {
    const html = await page("/servers", { ...ana, guilds: [] });
    expectHeadingsInOrder(html);
    expect(headingLevels(html)).toEqual([1, 2]);
    expect(primaryButtons(html)).toEqual([]);
    expect(html).not.toContain("server-tile");
    const href = inviteUrl(env).replaceAll("&", "&amp;");
    expect(html).toContain(
      `<a class="button button--secondary" href="${href}">`,
    );
    expect((await outline(html)).text).toContain(
      "hikebot is not in any of your servers",
    );
  });
});

describe("the sign-in cancelled page", () => {
  it("has one primary action, Try again, and a quiet way home", async () => {
    const html = await htmlResponse(<SignInCancelledPage />).text();
    expectHeadingsInOrder(html);
    expect(primaryButtons(html)).toEqual([
      '<a class="button button--primary" href="/login">',
    ]);
    expect(html).toContain('<a class="button button--quiet" href="/">');
    const text = (await outline(html)).text;
    expect(text).toContain("Try again");
    expect(text).toContain("Go to the home page");
  });
});

describe("inviteUrl", () => {
  it("asks for the bot and its commands with the permissions README.md lists", () => {
    const url = new URL(
      inviteUrl({
        DISCORD_APPLICATION_ID: "123",
        DISCORD_OAUTH_AUTHORIZE_URL: "https://discord.com/oauth2/authorize",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://discord.com/oauth2/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "123",
      scope: "bot applications.commands",
      permissions: INVITE_PERMISSIONS,
    });
    // View Channel, Send Messages, Embed Links, Read Message History,
    // Create Public Threads, Send Messages in Threads, Create Events.
    expect(INVITE_PERMISSIONS).toBe(
      String(
        2 ** 10 + 2 ** 11 + 2 ** 14 + 2 ** 16 + 2 ** 35 + 2 ** 38 + 2 ** 44,
      ),
    );
  });
});
