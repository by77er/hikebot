import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebView } from "../../src/guild/web-view";
import { csrfToken } from "../../src/web/auth/csrf";
import { sessionCookie, type Session } from "../../src/web/auth/session";
import { webRouter } from "../../src/web/routes";
import { outline } from "./helpers";
import { baseView, GUILD, hikePlace, plannedHike } from "./pages/server/view";

const USER = "400000000000007001";
const ORIGIN = "https://hikebot.example";

afterEach(() => {
  vi.restoreAllMocks();
});

function session(): Session {
  return {
    userId: USER,
    name: "Ana",
    avatar: null,
    guilds: [{ id: GUILD, name: "Ridge Walkers", icon: null }],
    issuedAt: Date.now(),
  };
}

async function cookie(): Promise<string> {
  return (await sessionCookie(env, session())).split(";")[0] ?? "";
}

/** A view of the planned hike without a pin, as an admin or a member sees it. */
function view(isAdmin: boolean, pinnable = true): WebView {
  const shown = baseView({
    plannedHike: plannedHike(),
    hikePlace: hikePlace({ pin: null, pinnable }),
  });
  return { ...shown, viewer: { ...shown.viewer, isAdmin } };
}

const SET = {
  kind: "set",
  location: "Mailbox Peak",
  point: "47.4875, -121.7234",
  notes: [],
};

/**
 * A GUILD_HIKE binding whose object answers `webView` with `shown` and
 * `webSetMapPin` with `outcome`.
 */
function guildObject(shown: WebView, outcome: unknown = SET) {
  const webView = vi.fn(() => Promise.resolve({ kind: "view", view: shown }));
  const webSetMapPin = vi.fn(() => Promise.resolve(outcome));
  const bindings = {
    ...env,
    GUILD_HIKE: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ webView, webSetMapPin })),
    },
  } as unknown as Env;
  return { bindings, webView, webSetMapPin };
}

async function getPage(bindings: Env) {
  return webRouter.handle(
    new Request(`${ORIGIN}/g/${GUILD}/map-pin`, {
      headers: { Cookie: await cookie() },
    }),
    bindings,
    createExecutionContext(),
  );
}

async function post(
  bindings: Env,
  fields: Record<string, string>,
  headers: Record<string, string> = {
    Origin: ORIGIN,
    "Sec-Fetch-Site": "same-origin",
  },
) {
  return webRouter.handle(
    new Request(`${ORIGIN}/g/${GUILD}/map-pin`, {
      method: "POST",
      headers: { Cookie: await cookie(), ...headers },
      body: new URLSearchParams(fields),
    }),
    bindings,
    createExecutionContext(),
  );
}

async function token(): Promise<string> {
  return csrfToken(env, session(), Date.now());
}

describe("Set map pin on the web", () => {
  it("gives an admin the form, filled with the hike's round", async () => {
    const { bindings } = guildObject(view(true));
    const response = await getPage(bindings);
    expect(response.status).toBe(200);
    const html = await response.text();
    const page = await outline(html);
    expect(page.title).toBe("Set map pin · Ridge Walkers · hikebot");
    expect(html).toContain(`action="/g/${GUILD}/map-pin"`);
    expect(html).toContain('name="round" value="12"');
    expect(page.scripts).toBe(0);
  });

  it("refuses the page to a member who is not an admin, and a hike that can no longer be pinned", async () => {
    const member = await getPage(guildObject(view(false)).bindings);
    expect(member.status).toBe(403);
    expect((await outline(await member.text())).title).toBe(
      "Only an admin can set the map pin · hikebot",
    );
    const gone = await getPage(guildObject(view(true, false)).bindings);
    expect(gone.status).toBe(404);
  });

  it("sets the pin for an admin through the guild object, which checks again, then goes back to the server's page", async () => {
    const { bindings, webSetMapPin } = guildObject(view(true), SET);
    const response = await post(bindings, {
      csrf: await token(),
      round: "12",
      point: "47.4875, -121.7234",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/g/${GUILD}#hike-place`);
    expect(webSetMapPin).toHaveBeenCalledWith({
      guildId: GUILD,
      userId: USER,
      roundId: 12,
      input: "47.4875, -121.7234",
    });
  });

  it("refuses a member who is not an admin without asking the guild object to act", async () => {
    const { bindings, webSetMapPin } = guildObject(view(false), SET);
    const response = await post(bindings, {
      csrf: await token(),
      round: "12",
      point: "47.4875, -121.7234",
    });
    expect(response.status).toBe(403);
    expect(webSetMapPin).not.toHaveBeenCalled();
  });

  it("refuses an admin whom the guild object no longer finds an admin", async () => {
    const { bindings } = guildObject(view(true), { kind: "not_admin" });
    const response = await post(bindings, {
      csrf: await token(),
      round: "12",
      point: "47.4875, -121.7234",
    });
    expect(response.status).toBe(403);
    expect((await outline(await response.text())).title).toBe(
      "Only an admin can set the map pin · hikebot",
    );
  });

  it("refuses a forged form: no token, another user's token, or another site", async () => {
    const { bindings, webSetMapPin } = guildObject(view(true), SET);
    const fields = { round: "12", point: "47.4875, -121.7234" };
    expect((await post(bindings, fields)).status).toBe(403);
    const other = await csrfToken(
      env,
      { ...session(), userId: "400000000000007999" },
      Date.now(),
    );
    expect((await post(bindings, { ...fields, csrf: other })).status).toBe(403);
    expect(
      (
        await post(
          bindings,
          { ...fields, csrf: await token() },
          { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
        )
      ).status,
    ).toBe(403);
    expect(webSetMapPin).not.toHaveBeenCalled();
  });

  it("comes back with the error at the field when no coordinates can be read", async () => {
    const { bindings } = guildObject(view(true), { kind: "unreadable" });
    const response = await post(bindings, {
      csrf: await token(),
      round: "12",
      point: "<b>somewhere</b>",
    });
    expect(response.status).toBe(400);
    const html = await response.text();
    const page = await outline(html);
    expect(page.title).toBe("Error: Set map pin · Ridge Walkers · hikebot");
    expect(page.text).toContain("The map pin was not set.");
    expect(page.text).toContain("No coordinates could be read from that");
    expect(html).toContain('value="&lt;b>somewhere&lt;/b>"');
    expect(page.scripts).toBe(0);
  });

  it("says a hike that can no longer be pinned cannot be", async () => {
    const { bindings } = guildObject(view(true), { kind: "not_pinnable" });
    const response = await post(bindings, {
      csrf: await token(),
      round: "11",
      point: "",
    });
    expect(response.status).toBe(409);
  });

  it("shows what failed after the pin was set", async () => {
    const { bindings } = guildObject(view(true), {
      ...SET,
      notes: ["Could not update the hike thread: Missing Access."],
    });
    const response = await post(bindings, {
      csrf: await token(),
      round: "12",
      point: "47.4875, -121.7234",
    });
    expect(response.status).toBe(200);
    const text = (await outline(await response.text())).text;
    expect(text).toContain(
      "The map pin of Mailbox Peak is set to 47.4875, -121.7234.",
    );
    expect(text).toContain("Could not update the hike thread: Missing Access.");
  });

  it("answers a POST to a path under a server with no action with 404", async () => {
    const { bindings } = guildObject(view(true));
    const response = await webRouter.handle(
      new Request(`${ORIGIN}/g/${GUILD}/nope`, {
        method: "POST",
        headers: { Cookie: await cookie(), Origin: ORIGIN },
      }),
      bindings,
      createExecutionContext(),
    );
    expect(response.status).toBe(404);
  });
});
