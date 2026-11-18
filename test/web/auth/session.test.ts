import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { seal } from "../../../src/signing";
import {
  MAX_SESSION_COOKIE_BYTES,
  MAX_SESSION_GUILDS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearSessionCookie,
  readSession,
  requireGuild,
  requireSession,
  sessionCookie,
  type Session,
} from "../../../src/web/auth/session";
import { outline } from "../helpers";

const NOW = Date.UTC(2026, 10, 18, 12);

const session: Session = {
  userId: "400000000000000001",
  name: "Ana",
  avatar: "a_0123456789abcdef0123456789abcdef",
  guilds: [
    { id: "200000000000000001", name: "Ridge Walkers", icon: null },
    { id: "200000000000000002", name: "Lake Loopers", icon: "abc" },
  ],
  issuedAt: NOW,
};

/** The `name=value` part of a `Set-Cookie` value. */
function pair(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

function withCookie(cookie: string | null, path = "/servers"): Request {
  return new Request(`https://hikebot.example${path}`, {
    headers: cookie === null ? {} : { Cookie: cookie },
  });
}

describe("sessionCookie", () => {
  it("sets the __Host- cookie HttpOnly, Secure, SameSite=Lax on / for seven days", async () => {
    const cookie = await sessionCookie(env, session);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]+\\.`));
    expect(cookie.split("; ").slice(1)).toEqual([
      "Max-Age=604800",
      "Path=/",
      "Secure",
      "HttpOnly",
      "SameSite=Lax",
    ]);
  });

  it("reads back as the same session", async () => {
    const cookie = pair(await sessionCookie(env, session));
    expect(await readSession(withCookie(cookie), env, NOW + 1)).toEqual(
      session,
    );
  });

  it("finds the cookie among others", async () => {
    const cookie = pair(await sessionCookie(env, session));
    const read = await readSession(
      withCookie(`theme=dark; ${cookie}; other=1`),
      env,
      NOW,
    );
    expect(read?.userId).toBe(session.userId);
  });

  it("stays under 4 KB with 25 servers with long names, shortening the names", async () => {
    const guilds = Array.from({ length: 30 }, (_, i) => ({
      id: String(200000000000000100n + BigInt(i)),
      name: `${"🥾 Long hiking club name ".repeat(5)}${String(i)}`.slice(
        0,
        100,
      ),
      icon: `a_${"f".repeat(32)}`,
    }));
    const cookie = pair(
      await sessionCookie(env, { ...session, name: "N".repeat(32), guilds }),
    );
    expect(cookie.length).toBeLessThanOrEqual(MAX_SESSION_COOKIE_BYTES);
    expect(new TextEncoder().encode(cookie).length).toBeLessThan(4096);
    const read = await readSession(withCookie(cookie), env, NOW);
    expect(read?.guilds).toHaveLength(MAX_SESSION_GUILDS);
    expect(read?.guilds.map((g) => g.id)).toEqual(
      guilds.slice(0, MAX_SESSION_GUILDS).map((g) => g.id),
    );
    for (const [i, guild] of (read?.guilds ?? []).entries()) {
      expect(guild.name.endsWith("…")).toBe(true);
      expect(guilds[i]?.name.startsWith(guild.name.slice(0, -1))).toBe(true);
    }
  });

  it("keeps short names whole", async () => {
    const cookie = pair(await sessionCookie(env, session));
    const read = await readSession(withCookie(cookie), env, NOW);
    expect(read?.guilds.map((g) => g.name)).toEqual([
      "Ridge Walkers",
      "Lake Loopers",
    ]);
  });
});

describe("readSession", () => {
  it("is signed out without a cookie", async () => {
    expect(await readSession(withCookie(null), env, NOW)).toBeNull();
  });

  it("is signed out once seven days have passed", async () => {
    const cookie = pair(await sessionCookie(env, session));
    expect(
      await readSession(withCookie(cookie), env, NOW + SESSION_TTL_MS - 1),
    ).not.toBeNull();
    expect(
      await readSession(withCookie(cookie), env, NOW + SESSION_TTL_MS),
    ).toBeNull();
  });

  it("is signed out with a tampered cookie", async () => {
    const cookie = pair(await sessionCookie(env, session));
    const [name, value = ""] = cookie.split("=");
    const [body = "", signature = ""] = value.split(".");
    const changed = body.slice(0, -2) + (body.endsWith("A") ? "BB" : "AA");
    expect(
      await readSession(
        withCookie(`${name ?? ""}=${changed}.${signature}`),
        env,
        NOW,
      ),
    ).toBeNull();
  });

  it("is signed out with a cookie sealed for another purpose", async () => {
    const token = await seal(env.SIGNING_SECRET, "csrf", { u: "1" }, NOW + 1e6);
    expect(
      await readSession(withCookie(`${SESSION_COOKIE}=${token}`), env, NOW),
    ).toBeNull();
  });

  it.each([
    ["garbage", "not-a-token"],
    ["empty", ""],
    ["oversized", "a".repeat(MAX_SESSION_COOKIE_BYTES + 1)],
  ])("is signed out with a %s cookie", async (_name, value) => {
    expect(
      await readSession(withCookie(`${SESSION_COOKIE}=${value}`), env, NOW),
    ).toBeNull();
  });
});

describe("clearSessionCookie", () => {
  it("expires the cookie with the same attributes", () => {
    expect(clearSessionCookie()).toBe(
      `${SESSION_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
    );
  });
});

describe("requireSession", () => {
  it("returns the session when there is one", async () => {
    const cookie = pair(await sessionCookie(env, session));
    expect(await requireSession(withCookie(cookie), env, NOW)).toEqual(session);
  });

  it("redirects to sign in, coming back to the page and its query", async () => {
    const response = await requireSession(
      withCookie(null, "/g/1?tab=hikes"),
      env,
      NOW,
    );
    expect(response).toBeInstanceOf(Response);
    const redirect = response as Response;
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("Location")).toBe(
      "/login?next=%2Fg%2F1%3Ftab%3Dhikes",
    );
  });

  it("redirects to plain /login when the path is no safe next", async () => {
    const response = (await requireSession(
      withCookie(null, "/a%5Cb"),
      env,
      NOW,
    )) as Response;
    expect(response.headers.get("Location")).toBe("/login");
  });
});

describe("requireGuild", () => {
  it("returns a server the session lists", () => {
    expect(requireGuild(session, "200000000000000002")).toEqual({
      id: "200000000000000002",
      name: "Lake Loopers",
      icon: "abc",
    });
  });

  it("answers the 404 page for a server it does not list", async () => {
    const response = requireGuild(session, "299999999999999999");
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(404);
    expect((await outline(await (response as Response).text())).title).toBe(
      "Page not found · hikebot",
    );
  });
});
