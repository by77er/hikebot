import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebViewResult } from "../../src/guild/web-view";
import { sessionCookie } from "../../src/web/auth/session";
import { webRouter } from "../../src/web/routes";
import { requireServer } from "../../src/web/server-guard";
import { discordFetch } from "../guild/web-view-helpers";
import { outline } from "./helpers";
import { baseView } from "./pages/server/view";

const OWNER = "400000000000008001";
const MEMBER = "400000000000008002";

let counter = 0;

/** A guild id no other test uses, so it gets a fresh object and cache. */
function freshGuild(): string {
  counter++;
  return `2000000000000080${String(counter).padStart(2, "0")}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The `Cookie` header of `userId` signed in, listing `guilds`. */
async function signedIn(userId: string, guilds: string[]): Promise<string> {
  const cookie = await sessionCookie(env, {
    userId,
    name: "Ana",
    avatar: null,
    guilds: guilds.map((id) => ({ id, name: "Listed name", icon: null })),
    issuedAt: Date.now(),
  });
  return cookie.split(";")[0] ?? "";
}

function get(path: string, cookie?: string, bindings: Env = env) {
  return webRouter.handle(
    new Request(`https://hikebot.example${path}`, {
      headers: cookie === undefined ? {} : { Cookie: cookie },
    }),
    bindings,
    createExecutionContext(),
  );
}

/** A GUILD_HIKE binding that fails the test if it is reached. */
function untouchedNamespace() {
  const idFromName = vi.fn();
  const get = vi.fn();
  const bindings = {
    ...env,
    GUILD_HIKE: { idFromName, get, idFromString: get },
  } as unknown as Env;
  return { bindings, idFromName, get };
}

/** A GUILD_HIKE binding whose objects answer `webView` with `result`. */
function answeringNamespace(result: WebViewResult) {
  const webView = vi.fn(() => Promise.resolve(result));
  const bindings = {
    ...env,
    GUILD_HIKE: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ webView })),
    },
  } as unknown as Env;
  return { bindings, webView };
}

/** Discord holds `guild` named Ridge Walkers, owned by OWNER, with MEMBER. */
function discordWith(guild: string, memberStatus?: number) {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    discordFetch({
      id: guild,
      name: "Ridge Walkers",
      ownerId: OWNER,
      members: { [OWNER]: [], [MEMBER]: [] },
      memberStatus,
    }),
  );
}

describe("the guard of a server's pages", () => {
  it("sends someone signed out to sign in and back", async () => {
    const guild = freshGuild();
    const page = await get(`/g/${guild}`);
    expect(page.status).toBe(303);
    expect(page.headers.get("Location")).toBe(
      `/login?next=${encodeURIComponent(`/g/${guild}`)}`,
    );
    const log = await get(`/g/${guild}/log?page=2`);
    expect(log.headers.get("Location")).toBe(
      `/login?next=${encodeURIComponent(`/g/${guild}/log?page=2`)}`,
    );
  });

  it("answers a server the session does not list with 404, without reaching its object", async () => {
    const guild = freshGuild();
    const cookie = await signedIn(MEMBER, [freshGuild()]);
    const { bindings, idFromName, get: getStub } = untouchedNamespace();
    for (const path of [`/g/${guild}`, `/g/${guild}/log?page=2`]) {
      const response = await get(path, cookie, bindings);
      expect(response.status).toBe(404);
      expect((await outline(await response.text())).title).toBe(
        "Page not found · hikebot",
      );
    }
    expect(idFromName).not.toHaveBeenCalled();
    expect(getStub).not.toHaveBeenCalled();
  });

  it("answers a path under a server with no page with 404, without reaching its object", async () => {
    const guild = freshGuild();
    const cookie = await signedIn(MEMBER, [guild]);
    const { bindings, idFromName } = untouchedNamespace();
    for (const path of [
      `/g/${guild}/nope`,
      `/g/${guild}/`,
      "/g/",
      `/g/${guild}/log/2`,
    ]) {
      expect((await get(path, cookie, bindings)).status, path).toBe(404);
    }
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("tells a user who is no longer a member, showing nothing of the server", async () => {
    const guild = freshGuild();
    discordWith(guild);
    const stranger = "400000000000008009";
    const response = await get(
      `/g/${guild}`,
      await signedIn(stranger, [guild]),
    );
    expect(response.status).toBe(403);
    const html = await response.text();
    const page = await outline(html);
    expect(page.text).toContain("You are not a member of this server any more");
    expect(html).toContain('href="/login?next=/servers"');
    expect(page.text).toContain("Refresh servers");
    expect(page.text).not.toContain("Ridge Walkers");
    expect(page.text).not.toContain("Listed name");
    expect(page.text).not.toContain("Calendar");
    expect(page.text).toContain("Signed in as Ana.");
  });

  it("asks to try again when Discord cannot be asked, with no detail from it", async () => {
    const guild = freshGuild();
    discordWith(guild, 500);
    const response = await get(
      `/g/${guild}/log?page=2`,
      await signedIn(MEMBER, [guild]),
    );
    expect(response.status).toBe(503);
    const html = await response.text();
    const page = await outline(html);
    expect(page.text).toContain("Discord could not be reached");
    expect(page.text).toContain("try again");
    expect(html).toContain(`href="/g/${guild}/log?page=2"`);
    expect(page.text).not.toContain("Internal Server Error");
    expect(page.text).not.toContain("Ridge Walkers");
    expect(page.text).toContain("Signed in as Ana.");
  });

  it("shows a member the server's page", async () => {
    const guild = freshGuild();
    discordWith(guild);
    const response = await get(`/g/${guild}`, await signedIn(MEMBER, [guild]));
    expect(response.status).toBe(200);
    const page = await outline(await response.text());
    expect(page.title).toBe("Ridge Walkers · hikebot");
    expect(page.text).toContain("No hike is being planned");
    expect(page.text).not.toContain("/hike admin");
    expect(page.text).toContain("Signed in as Ana.");
  });

  it("tells an admin where to start a vote", async () => {
    const guild = freshGuild();
    discordWith(guild);
    const response = await get(`/g/${guild}`, await signedIn(OWNER, [guild]));
    expect(response.status).toBe(200);
    expect((await outline(await response.text())).text).toContain(
      "start one in Discord with /hike admin, then Start location vote.",
    );
  });

  it("reads five hikes for the server's page and ten for each page of the log", async () => {
    const guild = freshGuild();
    const cookie = await signedIn(MEMBER, [guild]);
    const { bindings, webView } = answeringNamespace({
      kind: "view",
      view: baseView(),
    });
    await get(`/g/${guild}`, cookie, bindings);
    await get(`/g/${guild}/log?page=2`, cookie, bindings);
    await get(`/g/${guild}/log?page=x`, cookie, bindings);
    await get(`/g/${guild}/log`, cookie, bindings);
    expect(webView.mock.calls).toEqual([
      [{ guildId: guild, userId: MEMBER, pageSize: 5 }],
      [{ guildId: guild, userId: MEMBER, page: 2, pageSize: 10 }],
      [{ guildId: guild, userId: MEMBER, page: 1, pageSize: 10 }],
      [{ guildId: guild, userId: MEMBER, page: 1, pageSize: 10 }],
    ]);
  });

  it("refuses an action without a session, rather than redirecting it", async () => {
    const guild = freshGuild();
    const { bindings, idFromName } = untouchedNamespace();
    const response = await requireServer(
      new Request(`https://hikebot.example/g/${guild}/vote`, {
        method: "POST",
      }),
      bindings,
      guild,
    );
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(403);
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("gives a member's action the view, the session and the user", async () => {
    const guild = freshGuild();
    const view = baseView();
    const { bindings } = answeringNamespace({ kind: "view", view });
    const server = await requireServer(
      new Request(`https://hikebot.example/g/${guild}`, {
        headers: { Cookie: await signedIn(MEMBER, [guild]) },
      }),
      bindings,
      guild,
    );
    expect(server).toMatchObject({
      view,
      session: { userId: MEMBER },
      user: { name: "Ana", avatar: null },
    });
  });
});
