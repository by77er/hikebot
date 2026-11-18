import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOT_GUILDS_TTL_MS,
  BotGuildCache,
  STATE_COOKIE,
  finishSignIn,
  startSignIn,
  type SignInDeps,
} from "../../../src/web/auth/oauth";
import { SESSION_COOKIE, readSession } from "../../../src/web/auth/session";
import { outline } from "../helpers";

const NOW = Date.UTC(2026, 10, 18, 12);
const SITE = "https://hikebot.example";
const API = "https://discord.test/api/v10";
const AUTHORIZE = "https://discord.test/oauth2/authorize";
const testEnv = {
  ...env,
  DISCORD_API_BASE: API,
  DISCORD_OAUTH_AUTHORIZE_URL: AUTHORIZE,
  DISCORD_APPLICATION_ID: "100000000000000001",
  DISCORD_CLIENT_SECRET: "unit-client-secret",
  PUBLIC_URL: SITE,
};
const CODE = "unit-code-123";
const ACCESS_TOKEN = "unit-access-token";

const USER = {
  id: "400000000000000001",
  username: "ana",
  global_name: "Ana",
  avatar: "abc",
};
const guild = (id: string, name: string) => ({
  id,
  name,
  icon: null,
  banner: null,
  owner: false,
  features: [],
  permissions: "0",
});
const SHARED = guild("200000000000000002", "Ridge Walkers");
const ALSO_SHARED = guild("200000000000000001", "Alpine Club");
const NOT_BOT = guild("200000000000000003", "Book Club");
const BOT_ONLY = guild("200000000000000004", "Elsewhere");

interface Sent {
  method: string;
  url: URL;
  authorization: string | null;
  contentType: string | null;
  body: string;
}

type Answer = (sent: Sent) => Response;

/**
 * A stand-in for Discord's OAuth2 and user routes. `answers` replaces the
 * answer of a route (`POST /oauth2/token`, …); `botPages` are the pages of
 * the bot's server list.
 */
function fakeDiscord(
  answers: Record<string, Answer> = {},
  botPages: unknown[][] = [[SHARED, ALSO_SHARED, BOT_ONLY]],
) {
  const sent: Sent[] = [];
  const pages = [...botPages];
  const routes: Record<string, Answer> = {
    "POST /oauth2/token": () =>
      Response.json({
        access_token: ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: 604800,
        refresh_token: "unit-refresh-token",
        scope: "identify guilds",
      }),
    "GET /users/@me": () => Response.json(USER),
    "GET /users/@me/guilds": (s) =>
      s.authorization?.startsWith("Bot ")
        ? Response.json(pages.shift() ?? [])
        : Response.json([NOT_BOT, SHARED, ALSO_SHARED]),
    "POST /oauth2/token/revoke": () => Response.json({}),
    ...answers,
  };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const entry: Sent = {
      method: request.method,
      url,
      authorization: request.headers.get("Authorization"),
      contentType: request.headers.get("Content-Type"),
      body: await request.text(),
    };
    sent.push(entry);
    const route =
      routes[`${request.method} ${url.pathname.replace(/^\/api\/v10/, "")}`];
    if (!route) throw new Error(`unexpected ${request.method} ${url.href}`);
    return route(entry);
  };
  return { fetch, sent };
}

function deps(
  fake: ReturnType<typeof fakeDiscord>,
  now = NOW,
  botGuilds = new BotGuildCache(),
): SignInDeps {
  let word = 0;
  return {
    now: () => now,
    random: (array) => array.map(() => (word += 0x01010101)),
    botGuilds,
    fetch: fake.fetch,
  };
}

/** `GET /login`, returning the redirect and the state cookie's `name=value`. */
async function login(d: SignInDeps, next?: string) {
  const query = next === undefined ? "" : `?next=${encodeURIComponent(next)}`;
  const response = await startSignIn(
    new Request(`${SITE}/login${query}`),
    testEnv,
    d,
  );
  const setCookie = response.headers.get("Set-Cookie") ?? "";
  const location = new URL(response.headers.get("Location") ?? "");
  return {
    response,
    location,
    setCookie,
    cookie: setCookie.split(";")[0] ?? "",
    state: location.searchParams.get("state") ?? "",
  };
}

async function callback(
  d: SignInDeps,
  query: Record<string, string>,
  cookie: string | null,
) {
  const ctx = createExecutionContext();
  const response = await finishSignIn(
    new Request(
      `${SITE}/auth/callback?${new URLSearchParams(query).toString()}`,
      {
        headers: cookie === null ? {} : { Cookie: cookie },
      },
    ),
    testEnv,
    ctx,
    d,
  );
  await waitOnExecutionContext(ctx);
  return { response, cookies: response.headers.getSetCookie() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /login", () => {
  it("sets a ten-minute state cookie and redirects to Discord's authorize address", async () => {
    const { response, location, setCookie, state } = await login(
      deps(fakeDiscord()),
    );
    expect(response.status).toBe(303);
    expect(`${location.origin}${location.pathname}`).toBe(AUTHORIZE);
    expect(Object.fromEntries(location.searchParams)).toEqual({
      response_type: "code",
      client_id: "100000000000000001",
      scope: "identify guilds",
      redirect_uri: `${SITE}/auth/callback`,
      state,
      prompt: "none",
    });
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(setCookie).toMatch(
      new RegExp(
        `^${STATE_COOKIE}=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax$`,
      ),
    );
  });

  it("uses Discord's address when the var is empty", async () => {
    const response = await startSignIn(
      new Request(`${SITE}/login`),
      { ...testEnv, DISCORD_OAUTH_AUTHORIZE_URL: "" },
      deps(fakeDiscord()),
    );
    expect(response.headers.get("Location")).toMatch(
      /^https:\/\/discord\.com\/oauth2\/authorize\?response_type=code&/,
    );
  });

  it("keeps a safe next and returns there after sign-in", async () => {
    const d = deps(fakeDiscord());
    const { cookie, state } = await login(d, "/g/1?tab=hikes");
    const { response } = await callback(d, { code: CODE, state }, cookie);
    expect(response.headers.get("Location")).toBe("/g/1?tab=hikes");
  });

  it.each(["https://evil.example/", "//evil.example", "/\\evil.example"])(
    "ignores the unsafe next %s",
    async (next) => {
      const d = deps(fakeDiscord());
      const { location, cookie, state } = await login(d, next);
      expect(location.href).not.toContain("evil");
      const { response } = await callback(d, { code: CODE, state }, cookie);
      expect(response.headers.get("Location")).toBe("/servers");
    },
  );
});

describe("GET /auth/callback", () => {
  it("exchanges the code, reads the user and servers, revokes the token and starts the session", async () => {
    const fake = fakeDiscord();
    const d = deps(fake);
    const { cookie, state } = await login(d);
    const { response, cookies } = await callback(
      d,
      { code: CODE, state },
      cookie,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/servers");
    const basic = `Basic ${btoa("100000000000000001:unit-client-secret")}`;
    expect(
      fake.sent.map((s) => [
        s.method,
        s.url.pathname + s.url.search,
        s.authorization,
      ]),
    ).toEqual([
      ["POST", "/api/v10/oauth2/token", basic],
      ["GET", "/api/v10/users/@me", `Bearer ${ACCESS_TOKEN}`],
      ["GET", "/api/v10/users/@me/guilds", `Bearer ${ACCESS_TOKEN}`],
      ["GET", "/api/v10/users/@me/guilds?limit=200", "Bot test-token"],
      ["POST", "/api/v10/oauth2/token/revoke", basic],
    ]);
    expect(fake.sent[0]?.contentType).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(fake.sent[0]?.body))).toEqual(
      {
        grant_type: "authorization_code",
        code: CODE,
        redirect_uri: `${SITE}/auth/callback`,
      },
    );
    expect(Object.fromEntries(new URLSearchParams(fake.sent[4]?.body))).toEqual(
      {
        token: ACCESS_TOKEN,
        token_type_hint: "access_token",
      },
    );

    expect(cookies).toHaveLength(2);
    expect(cookies[1]).toBe(
      `${STATE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
    );
    const session = await readSession(
      new Request(SITE, {
        headers: { Cookie: cookies[0]?.split(";")[0] ?? "" },
      }),
      testEnv,
      NOW,
    );
    expect(session).toEqual({
      userId: USER.id,
      name: "Ana",
      avatar: "abc",
      guilds: [
        { id: ALSO_SHARED.id, name: "Alpine Club", icon: null },
        { id: SHARED.id, name: "Ridge Walkers", icon: null },
      ],
      issuedAt: NOW,
    });
    expect(cookies.join("\n")).not.toContain(ACCESS_TOKEN);
  });

  it("uses the username when the user has no display name", async () => {
    const fake = fakeDiscord({
      "GET /users/@me": () => Response.json({ ...USER, global_name: null }),
    });
    const d = deps(fake);
    const { cookie, state } = await login(d);
    const { cookies } = await callback(d, { code: CODE, state }, cookie);
    const session = await readSession(
      new Request(SITE, {
        headers: { Cookie: cookies[0]?.split(";")[0] ?? "" },
      }),
      testEnv,
      NOW,
    );
    expect(session?.name).toBe("ana");
  });

  async function expectFailed(
    response: Response,
    status: number,
    secrets: string[] = [],
  ) {
    expect(response.status).toBe(status);
    expect(response.headers.getSetCookie()).toEqual([
      `${STATE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
    ]);
    const html = await response.text();
    expect((await outline(html)).title).toBe("Sign-in failed · hikebot");
    expect(html).toContain('href="/login"');
    for (const secret of secrets) expect(html).not.toContain(secret);
  }

  it("refuses a callback without the state cookie, exchanging nothing", async () => {
    const fake = fakeDiscord();
    const d = deps(fake);
    const { state } = await login(d);
    const { response } = await callback(d, { code: CODE, state }, null);
    await expectFailed(response, 400, [CODE, state]);
    expect(fake.sent).toEqual([]);
  });

  it("refuses a mismatched or missing state, exchanging nothing", async () => {
    const fake = fakeDiscord();
    const d = deps(fake);
    const { cookie, state } = await login(d);
    const other = `${state.slice(0, -1)}${state.endsWith("0") ? "1" : "0"}`;
    await expectFailed(
      (await callback(d, { code: CODE, state: other }, cookie)).response,
      400,
      [CODE, other],
    );
    await expectFailed(
      (await callback(d, { code: CODE }, cookie)).response,
      400,
      [CODE],
    );
    expect(fake.sent).toEqual([]);
  });

  it("refuses a state cookie older than ten minutes", async () => {
    const fake = fakeDiscord();
    const { cookie, state } = await login(deps(fake));
    const later = deps(fake, NOW + 10 * 60 * 1000);
    await expectFailed(
      (await callback(later, { code: CODE, state }, cookie)).response,
      400,
    );
    expect(fake.sent).toEqual([]);
  });

  it("shows the cancelled page when the user said no at Discord", async () => {
    const fake = fakeDiscord();
    const d = deps(fake);
    const { cookie, state } = await login(d);
    const { response, cookies } = await callback(
      d,
      {
        error: "access_denied",
        error_description: "The resource owner denied",
        state,
      },
      cookie,
    );
    expect(response.status).toBe(200);
    const page = await outline(await response.text());
    expect(page.title).toBe("Sign-in was cancelled · hikebot");
    expect(page.text).toContain("Try again");
    expect(cookies).toEqual([
      `${STATE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
    ]);
    expect(fake.sent).toEqual([]);
  });

  it("refuses another error from Discord", async () => {
    const fake = fakeDiscord();
    const d = deps(fake);
    const { cookie, state } = await login(d);
    await expectFailed(
      (await callback(d, { error: "invalid_scope", state }, cookie)).response,
      400,
    );
    expect(fake.sent).toEqual([]);
  });

  it("answers 502 when the token exchange fails, logging no secret", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fake = fakeDiscord({
      "POST /oauth2/token": () =>
        Response.json(
          {
            error: "invalid_grant",
            error_description: `Invalid "code" in request.`,
          },
          { status: 400 },
        ),
    });
    const d = deps(fake);
    const { cookie, state } = await login(d);
    const { response } = await callback(d, { code: CODE, state }, cookie);
    await expectFailed(response, 502, [CODE, state]);
    expect(fake.sent.map((s) => s.url.pathname)).toEqual([
      "/api/v10/oauth2/token",
    ]);
    expect(errors.mock.calls.flat().join("\n")).toBe(
      "sign-in failed: POST /oauth2/token answered 400",
    );
  });

  it("answers 502 when reading the user fails, and still revokes the token", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fake = fakeDiscord({
      "GET /users/@me": () =>
        Response.json(
          { message: "401: Unauthorized", code: 0 },
          { status: 401 },
        ),
    });
    const d = deps(fake);
    const { cookie, state } = await login(d);
    const { response } = await callback(d, { code: CODE, state }, cookie);
    await expectFailed(response, 502);
    expect(fake.sent.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
      "POST /api/v10/oauth2/token",
      "GET /api/v10/users/@me",
      "POST /api/v10/oauth2/token/revoke",
    ]);
    const logged = errors.mock.calls.flat().join("\n");
    expect(logged).toBe("sign-in failed: GET /users/@me answered 401");
    for (const secret of [ACCESS_TOKEN, CODE, "unit-client-secret"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("signs in even when revoking the token fails", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fake = fakeDiscord({
      "POST /oauth2/token/revoke": () =>
        Response.json({ error: "server_error" }, { status: 500 }),
    });
    const d = deps(fake);
    const { cookie, state } = await login(d);
    const { response, cookies } = await callback(
      d,
      { code: CODE, state },
      cookie,
    );
    expect(response.status).toBe(303);
    expect(cookies[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    const logged = errors.mock.calls.flat().join("\n");
    expect(logged).toBe(
      "sign-in token revoke failed: POST /oauth2/token/revoke answered 500",
    );
    expect(logged).not.toContain(ACCESS_TOKEN);
  });

  it("answers 502 when the bot's server list cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fake = fakeDiscord({
      "GET /users/@me/guilds": (s) =>
        s.authorization?.startsWith("Bot ")
          ? Response.json({ message: "500", code: 0 }, { status: 500 })
          : Response.json([SHARED]),
    });
    const d = deps(fake);
    const { cookie, state } = await login(d);
    await expectFailed(
      (await callback(d, { code: CODE, state }, cookie)).response,
      502,
    );
  });
});

describe("the bot's server list", () => {
  const botReads = (fake: ReturnType<typeof fakeDiscord>) =>
    fake.sent
      .filter((s) => s.authorization?.startsWith("Bot "))
      .map((s) => s.url.search);

  it("reads every page of 200", async () => {
    const page = Array.from({ length: 200 }, (_, i) =>
      guild(String(210000000000000000n + BigInt(i)), `G${String(i)}`),
    );
    const fake = fakeDiscord({}, [page, [SHARED]]);
    const d = deps(fake);
    const { cookie, state } = await login(d);
    await callback(d, { code: CODE, state }, cookie);
    expect(botReads(fake)).toEqual([
      "?limit=200",
      `?after=${page[199]?.id ?? ""}&limit=200`,
    ]);
  });

  it("is reused for 60 seconds, then read again", async () => {
    const fake = fakeDiscord({}, [[SHARED], [SHARED], [SHARED]]);
    const cache = new BotGuildCache();
    for (const at of [
      NOW,
      NOW + BOT_GUILDS_TTL_MS - 1,
      NOW + BOT_GUILDS_TTL_MS,
    ]) {
      const d = deps(fake, at, cache);
      const { cookie, state } = await login(d);
      await callback(d, { code: CODE, state }, cookie);
    }
    expect(botReads(fake)).toEqual(["?limit=200", "?limit=200"]);
  });
});
