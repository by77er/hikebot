import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { csrfToken } from "../../../src/web/auth/csrf";
import { BotGuildCache } from "../../../src/web/auth/oauth";
import { addSignInRoutes } from "../../../src/web/auth/routes";
import {
  SESSION_COOKIE,
  sessionCookie,
  type Session,
} from "../../../src/web/auth/session";
import { WebRouter } from "../../../src/web/router";
import { EXPECTED_PAGE_HEADERS, outline, pageHeaders } from "../helpers";

const NOW = Date.UTC(2026, 10, 18, 12);
const SITE = "https://hikebot.example";

const router = addSignInRoutes(
  new WebRouter({
    notFound: () => new Response("not found", { status: 404 }),
    methodNotAllowed: () => new Response("no", { status: 405 }),
  }),
  {
    now: () => NOW,
    random: (array) => array.fill(7),
    botGuilds: new BotGuildCache(),
  },
);

const ana: Session = {
  userId: "400000000000000001",
  name: "Ana",
  avatar: null,
  guilds: [
    { id: "200000000000000001", name: "Alpine Club", icon: null },
    { id: "200000000000000002", name: "Ridge Walkers", icon: null },
  ],
  issuedAt: NOW,
};

async function cookieFor(session: Session): Promise<string> {
  return (await sessionCookie(env, session)).split(";")[0] ?? "";
}

function send(path: string, init: RequestInit = {}): Promise<Response> {
  return router.handle(
    new Request(`${SITE}${path}`, init),
    env,
    createExecutionContext(),
  );
}

describe("GET /servers", () => {
  it("lists the session's servers, linking to their pages", async () => {
    const response = await send("/servers", {
      headers: { Cookie: await cookieFor(ana) },
    });
    expect(response.status).toBe(200);
    expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
    const html = await response.text();
    expect(html).toMatch(
      /<a class="server-tile" href="\/g\/200000000000000001">.*<span class="server-tile__name">Alpine Club<\/span>/,
    );
    expect(html).toMatch(
      /<a class="server-tile" href="\/g\/200000000000000002">.*<span class="server-tile__name">Ridge Walkers<\/span>/,
    );
    expect(html).toContain(
      '<a class="button button--quiet" href="/login?next=/servers"><span>Refresh servers</span></a>',
    );
    const page = await outline(html);
    expect(page.title).toBe("Choose a server · hikebot");
    expect(page.text).toContain("Signed in as Ana.");
    expect(page.text).not.toContain("not in any of your servers");
  });

  it("says so when hikebot is in none of them", async () => {
    const response = await send("/servers", {
      headers: { Cookie: await cookieFor({ ...ana, guilds: [] }) },
    });
    const page = await outline(await response.text());
    expect(page.text).toContain("hikebot is not in any of your servers");
    expect(page.text).toContain("A server admin can add it to their server");
    expect(page.elements).not.toContain("ul");
  });

  it("shows a server name holding markup as text", async () => {
    const response = await send("/servers", {
      headers: {
        Cookie: await cookieFor({
          ...ana,
          guilds: [
            {
              id: "200000000000000009",
              name: "<script>alert(1)</script><img src=x onerror=alert(2)>",
              icon: null,
            },
          ],
        }),
      },
    });
    const html = await response.text();
    const page = await outline(html);
    expect(page.scripts).toBe(0);
    expect(page.eventAttributes).toBe(0);
    expect(page.elements).not.toContain("img");
    expect(html).toContain(
      "&lt;script>alert(1)&lt;/script>&lt;img src=x onerror=alert(2)>",
    );
  });

  it("sends someone signed out to sign in, coming back here", async () => {
    const response = await send("/servers");
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/login?next=%2Fservers");
  });

  it("treats a tampered cookie as signed out", async () => {
    const cookie = await cookieFor(ana);
    const response = await send("/servers", {
      headers: { Cookie: `${cookie.slice(0, -3)}AAA` },
    });
    expect(response.status).toBe(303);
  });
});

describe("POST /logout", () => {
  async function logout(headers: Record<string, string>, csrf?: string) {
    return send("/logout", {
      method: "POST",
      headers: {
        Cookie: await cookieFor(ana),
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(csrf === undefined ? {} : { csrf }).toString(),
    });
  }

  it("clears the cookie and returns to the landing page", async () => {
    const response = await logout(
      { Origin: SITE },
      await csrfToken(env, ana, NOW),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.getSetCookie()).toEqual([
      `${SESSION_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
    ]);
  });

  it("is refused with 403 without the token", async () => {
    const response = await logout({ Origin: SITE });
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("is refused with 403 from another site, even with the token", async () => {
    const token = await csrfToken(env, ana, NOW);
    const crossSite: Record<string, string>[] = [
      { Origin: "https://evil.example" },
      { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" },
    ];
    for (const headers of crossSite) {
      const response = await logout(headers, token);
      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it("is refused with 403 with another user's token", async () => {
    const response = await logout(
      { Origin: SITE },
      await csrfToken(env, { ...ana, userId: "4009" }, NOW),
    );
    expect(response.status).toBe(403);
  });

  it("only clears the cookie for someone already signed out", async () => {
    const response = await send("/logout", { method: "POST" });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/");
  });
});
