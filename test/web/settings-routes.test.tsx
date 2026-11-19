import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WebSettingsResult,
  WebViewResult,
} from "../../src/guild/web-view";
import { csrfToken } from "../../src/web/auth/csrf";
import { sessionCookie, type Session } from "../../src/web/auth/session";
import { webRouter } from "../../src/web/routes";
import { EXPECTED_PAGE_HEADERS, outline, pageHeaders } from "./helpers";
import { adminView, emptyForm, VOTES } from "./pages/server/settings/form";
import { baseView, GUILD, VIEWER } from "./pages/server/view";

const SITE = "https://hikebot.example";
const PATH = `/g/${GUILD}/settings`;

afterEach(() => {
  vi.restoreAllMocks();
});

function session(userId = VIEWER, guilds = [GUILD]): Session {
  return {
    userId,
    name: "Ana",
    avatar: null,
    guilds: guilds.map((id) => ({ id, name: "Listed name", icon: null })),
    issuedAt: Date.now(),
  };
}

async function cookieFor(signedIn: Session): Promise<string> {
  return (await sessionCookie(env, signedIn)).split(";")[0] ?? "";
}

/**
 * A GUILD_HIKE binding whose object answers `webView` with `read` and
 * `saveSettings` with `saved`, recording both calls.
 */
function namespace(
  read: WebViewResult,
  saved: WebSettingsResult = { kind: "saved", notices: [] },
) {
  const webView = vi.fn(() => Promise.resolve(read));
  const saveSettings = vi.fn(() => Promise.resolve(saved));
  const bindings = {
    ...env,
    GUILD_HIKE: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ webView, saveSettings })),
    },
  } as unknown as Env;
  return { bindings, webView, saveSettings };
}

const ADMIN_READ: WebViewResult = {
  kind: "view",
  view: adminView(emptyForm()),
};
const MEMBER_READ: WebViewResult = { kind: "view", view: baseView() };

function get(path: string, cookie: string, bindings: Env) {
  return webRouter.handle(
    new Request(`${SITE}${path}`, { headers: { Cookie: cookie } }),
    bindings,
    createExecutionContext(),
  );
}

/** The cookie a response sets, as a request sends it back. */
function setCookieOf(response: Response): string {
  return (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

/** A POST of the form `fields`, from this site unless `headers` say not. */
async function post(
  bindings: Env,
  fields: Record<string, string>,
  options: {
    signedIn?: Session | null;
    headers?: Record<string, string>;
    csrf?: string | null;
  } = {},
) {
  const signedIn =
    options.signedIn === undefined ? session() : options.signedIn;
  const form = new URLSearchParams(fields);
  const csrf =
    options.csrf === undefined && signedIn !== null
      ? await csrfToken(env, signedIn, Date.now())
      : options.csrf;
  if (csrf !== null && csrf !== undefined) form.set("csrf", csrf);
  return webRouter.handle(
    new Request(`${SITE}${PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: SITE,
        ...(signedIn === null ? {} : { Cookie: await cookieFor(signedIn) }),
        ...options.headers,
      },
      body: form.toString(),
    }),
    bindings,
    createExecutionContext(),
  );
}

describe("GET /g/<guild id>/settings", () => {
  it("shows an admin the settings, asking the read for its forms", async () => {
    const { bindings, webView } = namespace(ADMIN_READ);
    const response = await get(PATH, await cookieFor(session()), bindings);
    expect(response.status).toBe(200);
    expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
    const page = await outline(await response.text());
    expect(page).toMatchObject({
      title: "Settings · Ridge Walkers · hikebot",
      scripts: 0,
    });
    expect(webView).toHaveBeenCalledWith({
      guildId: GUILD,
      userId: VIEWER,
      settingsForm: true,
    });
  });

  it("answers a member who is not an admin with the 403 page", async () => {
    const { bindings } = namespace(MEMBER_READ);
    const response = await get(PATH, await cookieFor(session()), bindings);
    expect(response.status).toBe(403);
    const page = await outline(await response.text());
    expect(page.title).toBe("Only admins can do this · hikebot");
    expect(page.text).toContain(
      "The hikebot admin panel is limited to the server owner and members with the admin role",
    );
    expect(page.text).not.toContain("Save channels");
  });

  it("sends someone signed out to sign in and back", async () => {
    const { bindings, webView } = namespace(ADMIN_READ);
    const response = await webRouter.handle(
      new Request(`${SITE}${PATH}`),
      bindings,
      createExecutionContext(),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      `/login?next=${encodeURIComponent(PATH)}`,
    );
    expect(webView).not.toHaveBeenCalled();
  });

  it("ignores a saved banner sealed for someone else", async () => {
    const { bindings } = namespace(ADMIN_READ, {
      kind: "saved",
      notices: [["Voting channel set to ", { channel: VOTES }, "."]],
    });
    const other = session("400000000000007999");
    const saved = await post(
      bindings,
      { group: "channels", voteChannelId: VOTES },
      { signedIn: other },
    );
    const response = await get(
      PATH,
      `${await cookieFor(session())}; ${setCookieOf(saved)}`,
      bindings,
    );
    expect((await outline(await response.text())).text).not.toContain(
      "Channels saved.",
    );
  });
});

describe("POST /g/<guild id>/settings", () => {
  it("saves the group and redirects back to it with what the save did", async () => {
    const { bindings, saveSettings } = namespace(ADMIN_READ, {
      kind: "saved",
      notices: [["Voting channel set to ", { channel: VOTES }, "."]],
    });
    const response = await post(bindings, {
      group: "channels",
      voteChannelId: VOTES,
      announceChannelId: "",
      forumChannelId: "",
    });
    expect(response.status).toBe(303);
    expect(saveSettings).toHaveBeenCalledWith({
      guildId: GUILD,
      userId: VIEWER,
      group: "channels",
      fields: {
        voteChannelId: VOTES,
        announceChannelId: "",
        forumChannelId: "",
      },
    });
    expect(response.headers.get("Location")).toBe(
      `/g/${GUILD}/settings#channels`,
    );
    const cookie = setCookieOf(response);
    expect(cookie).toMatch(/^__Host-hikebot_settings_saved=.+/);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    const page = await get(
      PATH,
      `${await cookieFor(session())}; ${cookie}`,
      bindings,
    );
    expect(page.headers.get("Set-Cookie")).toContain(
      "__Host-hikebot_settings_saved=; Max-Age=0",
    );
    const text = (await outline(await page.text())).text;
    expect(text).toContain("Channels saved.");
    expect(text).toContain("Voting channel set to #votes.");
  });

  it("answers a refused save with the page, the refusal in the panel's words, and 400", async () => {
    const { bindings } = namespace(ADMIN_READ, {
      kind: "refused",
      errors: [
        {
          key: "cadence.enabled",
          refusal: [
            "The schedule needs the voting channel. Set them above, then turn it on.",
          ],
        },
      ],
    });
    const response = await post(bindings, {
      group: "schedule",
      "cadence.enabled": "on",
      "cadence.weekday": "3",
      "cadence.time": "09:00",
      "cadence.dateVoteDays": "2",
    });
    expect(response.status).toBe(400);
    const page = await outline(await response.text());
    expect(page.title).toBe("Error: Settings · Ridge Walkers · hikebot");
    expect(page.text).toContain(
      "The schedule needs the voting channel. Set them above, then turn it on.",
    );
  });

  it("answers with the 403 page when the guild object says the user is no longer an admin", async () => {
    const { bindings, saveSettings } = namespace(ADMIN_READ, {
      kind: "forbidden",
    });
    const response = await post(bindings, { group: "units", units: "metric" });
    expect(response.status).toBe(403);
    expect(saveSettings).toHaveBeenCalledOnce();
    expect((await outline(await response.text())).title).toBe(
      "Only admins can do this · hikebot",
    );
  });

  it("refuses a forged form: no token, another user's token, another site, or no group, saving nothing", async () => {
    const { bindings, saveSettings } = namespace(ADMIN_READ);
    const units = { group: "units", units: "metric" };
    const forged = [
      await post(bindings, units, { csrf: null }),
      await post(bindings, units, {
        csrf: await csrfToken(env, session("400000000000007999"), Date.now()),
      }),
      await post(bindings, units, {
        headers: {
          Origin: "https://evil.example",
          "Sec-Fetch-Site": "cross-site",
        },
      }),
      await post(bindings, { group: "everything", units: "metric" }),
      await post(bindings, units, { signedIn: null }),
    ];
    for (const response of forged) expect(response.status).toBe(403);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("turns away a server the session does not list before reaching its object", async () => {
    const { bindings, saveSettings, webView } = namespace(ADMIN_READ);
    const response = await post(
      bindings,
      { group: "units", units: "metric" },
      { signedIn: session(VIEWER, ["200000000000007002"]) },
    );
    expect(response.status).toBe(404);
    expect(webView).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
