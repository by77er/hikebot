/**
 * Signing in to the web site with Discord, against the real bundle with the
 * fake Discord API playing the OAuth2 provider: the servers a member sees,
 * cancelling at Discord, a replayed callback, a tampered cookie, signing out
 * through the page's form, a cross-site POST, and coming back to the page
 * asked for. Everything is checked through pages, statuses, headers and
 * redirects.
 */
import { describe, expect, it } from "vitest";
import { eventually } from "./harness/helpers";
import { formFields, PageClient } from "./harness/web";
import { CLIENT_SECRET, useE2E } from "./harness/worker";

const e2e = useE2E();

const SESSION = "__Host-hikebot_session";
const STATE = "__Host-hikebot_oauth_state";

/** A member of one server the bot is in and one it is not in. */
function member(n: number) {
  const id = String(400000000000000700n + BigInt(n));
  const withBot = {
    id: String(200000000000000700n + BigInt(n)),
    name: `Ridge Walkers ${String(n)}`,
  };
  const withoutBot = {
    id: String(200000000000000800n + BigInt(n)),
    name: `Book Club ${String(n)}`,
  };
  e2e.discord.addGuild({ id: withBot.id, ownerId: id, name: withBot.name });
  e2e.discord.addUser({
    id,
    username: `hiker${String(n)}`,
    globalName: `Hiker ${String(n)}`,
    guilds: [withoutBot, withBot],
  });
  return { id, withBot, withoutBot };
}

describe("signing in", () => {
  it("lists the servers the member shares with hikebot, and no other", async () => {
    const ana = member(1);
    const client = new PageClient(e2e.url);
    const callback = await client.signIn(ana);
    expect(callback.status).toBe(303);
    expect(callback.location?.pathname).toBe("/servers");
    const [session] = callback.headers
      .getSetCookie()
      .filter((c) => c.startsWith(`${SESSION}=`));
    expect(session?.split("; ").slice(1)).toEqual([
      "Max-Age=604800",
      "Path=/",
      "Secure",
      "HttpOnly",
      "SameSite=Lax",
    ]);
    expect(client.cookies.has(STATE)).toBe(false);

    const servers = await client.get("/servers");
    expect(servers.status).toBe(200);
    expect(servers.body).toContain("<title>Your servers · hikebot</title>");
    expect(servers.body).toContain(
      `<a href="/g/${ana.withBot.id}">${ana.withBot.name}</a>`,
    );
    expect(servers.body).not.toContain(ana.withoutBot.name);
    expect(servers.body).toContain("Signed in as Hiker 1.");
    expect(servers.body).toContain(
      '<button class="button button--quiet" type="submit"><span>Sign out</span></button>',
    );
    expect(servers.body).toContain(
      '<a href="/login?next=/servers">Refresh servers</a>',
    );

    const home = await client.get("/");
    expect(home.status).toBe(303);
    expect(home.location?.pathname).toBe("/servers");
  });

  it("revokes the member's Discord token and keeps none", async () => {
    const ben = member(2);
    const client = new PageClient(e2e.url);
    await client.signIn(ben);
    await eventually(() => {
      expect(e2e.discord.oauth.liveTokens()).toEqual([]);
    });
    const revoke = await e2e.discord.nextRequest(
      (r) => r.path === "/oauth2/token/revoke",
    );
    expect(revoke.status).toBe(200);
    for (const token of e2e.discord.oauth.issued.tokens) {
      expect([...client.cookies.values()].join(";")).not.toContain(token);
    }
  });

  it("says so when hikebot is in none of the member's servers", async () => {
    const id = "400000000000000799";
    e2e.discord.addUser({
      id,
      username: "loner",
      guilds: [{ id: "200000000000000899", name: "Solo" }],
    });
    const client = new PageClient(e2e.url);
    await client.signIn({ id });
    const servers = await client.get("/servers");
    expect(servers.body).toContain(
      "hikebot is not in any of your servers. A server admin can add it to their server.",
    );
    expect(servers.body).toContain("Signed in as loner.");
  });

  it("shows the cancelled page when the member cancels at Discord", async () => {
    const cy = member(3);
    const client = new PageClient(e2e.url);
    const cancelled = await client.signIn(cy, { cancel: true });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toContain(
      "<title>Sign-in was cancelled · hikebot</title>",
    );
    expect(cancelled.body).toContain('<a href="/login">Try again</a>');
    expect(client.cookies.size).toBe(0);
    expect((await client.get("/servers")).status).toBe(303);
  });

  it("refuses a replayed callback without exchanging the code again", async () => {
    const dee = member(4);
    const client = new PageClient(e2e.url);
    const first = await client.signIn(dee);
    expect(first.status).toBe(303);
    const exchanges = () =>
      e2e.discord.requests.filter((r) => r.path === "/oauth2/token").length;
    const before = exchanges();

    const replay = await new PageClient(e2e.url).get(
      first.url.pathname + first.url.search,
    );
    expect(replay.status).toBe(400);
    expect(replay.body).toContain("<title>Sign-in failed · hikebot</title>");
    const code = first.url.searchParams.get("code") ?? "";
    const state = first.url.searchParams.get("state") ?? "";
    expect(replay.body).not.toContain(code);
    expect(replay.body).not.toContain(state);
    expect(replay.headers.getSetCookie().join()).not.toContain(`${SESSION}=`);
    expect(exchanges()).toBe(before);
  });

  it("fails a replay that kept the state cookie, since Discord takes a code once", async () => {
    const eve = member(5);
    const client = new PageClient(e2e.url);
    const login = await client.get("/login");
    const stateCookie = client.cookies.get(STATE) ?? "";
    const authorize = await fetch(login.location ?? "", {
      headers: { Cookie: `fake_discord_user=${eve.id}` },
      redirect: "manual",
    });
    const back = new URL(authorize.headers.get("Location") ?? "");
    const callback = back.pathname + back.search;
    expect((await client.get(callback)).status).toBe(303);

    const thief = new PageClient(e2e.url);
    thief.cookies.set(STATE, stateCookie);
    const replay = await thief.get(callback);
    expect(replay.status).toBe(502);
    expect(replay.body).toContain("<title>Sign-in failed · hikebot</title>");
    expect(thief.cookies.has(SESSION)).toBe(false);
    const refused = e2e.discord.takeRejections();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      method: "POST",
      route: "/oauth2/token",
      status: 400,
      response: { error: "invalid_grant", rule: "oauth2-code-used-once" },
    });
  });

  it("treats a tampered session cookie as signed out", async () => {
    const fay = member(6);
    const client = new PageClient(e2e.url);
    await client.signIn(fay);
    const cookie = client.cookies.get(SESSION) ?? "";
    const [body = "", signature = ""] = cookie.split(".");
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as { data: { g: unknown[] } };
    payload.data.g.push(["200000000000000999", "Not mine", null]);
    client.cookies.set(
      SESSION,
      `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`,
    );
    const servers = await client.get("/servers");
    expect(servers.status).toBe(303);
    expect(servers.location?.pathname).toBe("/login");
    const home = await client.get("/");
    expect(home.status).toBe(200);
    expect(home.body).toContain('<a href="/login">Sign in with Discord</a>');
  });
});

describe("signing out", () => {
  it("signs out through the page's Sign out form", async () => {
    const gus = member(7);
    const client = new PageClient(e2e.url);
    await client.signIn(gus);
    const servers = await client.get("/servers");
    const out = await client.submitForm(servers, "/logout");
    expect(out.status).toBe(303);
    expect(out.location?.pathname).toBe("/");
    expect(client.cookies.has(SESSION)).toBe(false);
    const home = await client.get("/");
    expect(home.status).toBe(200);
    expect(home.body).toContain("Sign in with Discord");
    expect(home.body).not.toContain("Sign out");
    expect((await client.get("/servers")).status).toBe(303);
  });

  it("refuses a cross-site POST, even with the page's token", async () => {
    const hal = member(8);
    const client = new PageClient(e2e.url);
    await client.signIn(hal);
    const servers = await client.get("/servers");
    const fields = formFields(servers.body, "/logout") ?? {};
    expect(fields.csrf).toMatch(/\./);
    const forged = await client.request("/logout", {
      form: fields,
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
    });
    expect(forged.status).toBe(403);
    expect(forged.body).toContain("<title>Request refused · hikebot</title>");
    expect(client.cookies.has(SESSION)).toBe(true);
    const missing = await client.request("/logout", {
      form: {},
      headers: { Origin: servers.url.origin },
    });
    expect(missing.status).toBe(403);
    expect((await client.get("/servers")).status).toBe(200);
  });
});

describe("coming back after sign-in", () => {
  it("returns to the page that asked for sign-in", async () => {
    const ivy = member(9);
    const client = new PageClient(e2e.url);
    const asked = await client.get("/servers");
    expect(asked.status).toBe(303);
    expect(asked.location?.pathname).toBe("/login");
    expect(asked.location?.searchParams.get("next")).toBe("/servers");

    const back = await client.signIn(ivy, { next: `/g/${ivy.withBot.id}` });
    expect(back.status).toBe(303);
    expect(back.location?.pathname).toBe(`/g/${ivy.withBot.id}`);
  });

  it("ignores a next that leaves the site", async () => {
    const jo = member(10);
    const client = new PageClient(e2e.url);
    for (const next of [
      "//evil.example/",
      "https://evil.example/",
      "/\\evil",
    ]) {
      const back = await client.signIn(jo, { next });
      expect(back.location?.href).toBe(new URL("/servers", e2e.url).href);
    }
  });
});

describe("the Worker's logs", () => {
  it("hold no client secret, code or token", () => {
    const logs = e2e.harness
      .getLogs()
      .map((log) => log.message)
      .join("\n");
    expect(logs).toContain("sign-in failed: POST /oauth2/token answered 400");
    const { codes, tokens } = e2e.discord.oauth.issued;
    expect(codes.length).toBeGreaterThan(0);
    expect(tokens.length).toBeGreaterThan(0);
    for (const secret of [CLIENT_SECRET, ...codes, ...tokens]) {
      expect(logs).not.toContain(secret);
    }
  });
});
