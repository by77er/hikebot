import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { seal } from "../../../src/signing";
import {
  CSRF_TTL_MS,
  CsrfField,
  checkPost,
  csrfToken,
  isSameOrigin,
  layoutUser,
} from "../../../src/web/auth/csrf";
import type { Session } from "../../../src/web/auth/session";
import { Layout } from "../../../src/web/layout";
import { htmlResponse } from "../../../src/web/response";
import { outline } from "../helpers";

const NOW = Date.UTC(2026, 10, 18, 12);
const ORIGIN = "https://hikebot.example";

const ana: Session = {
  userId: "400000000000000001",
  name: "Ana",
  avatar: null,
  guilds: [],
  issuedAt: NOW,
};

function post(
  fields: Record<string, string>,
  headers: Record<string, string> = { Origin: ORIGIN },
): Request {
  return new Request(`${ORIGIN}/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

describe("checkPost", () => {
  it("returns the form for a same-origin POST with the user's token", async () => {
    const token = await csrfToken(env, ana, NOW);
    const form = await checkPost(post({ csrf: token, x: "1" }), env, ana, NOW);
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("x")).toBe("1");
  });

  it("accepts Sec-Fetch-Site: same-origin without Origin", async () => {
    const token = await csrfToken(env, ana, NOW);
    const form = await checkPost(
      post({ csrf: token }, { "Sec-Fetch-Site": "same-origin" }),
      env,
      ana,
      NOW,
    );
    expect(form).toBeInstanceOf(FormData);
  });

  async function refused(request: Request, session = ana, now = NOW) {
    const response = await checkPost(request, env, session, now);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(403);
    expect((await outline(await (response as Response).text())).title).toBe(
      "Request refused · hikebot",
    );
  }

  it("refuses a POST without a token", async () => {
    await refused(post({}));
  });

  it("refuses a token bound to another user", async () => {
    const token = await csrfToken(env, { ...ana, userId: "4002" }, NOW);
    await refused(post({ csrf: token }));
  });

  it("refuses an expired token", async () => {
    const token = await csrfToken(env, ana, NOW);
    await refused(post({ csrf: token }), ana, NOW + CSRF_TTL_MS);
  });

  it("refuses a token sealed for another purpose", async () => {
    const token = await seal(
      env.SIGNING_SECRET,
      "session",
      { u: ana.userId },
      NOW + 1000,
    );
    await refused(post({ csrf: token }));
  });

  it.each([
    ["another Origin", { Origin: "https://evil.example" }],
    ["Sec-Fetch-Site: cross-site", { "Sec-Fetch-Site": "cross-site" }],
    ["Sec-Fetch-Site: same-site", { "Sec-Fetch-Site": "same-site" }],
    [
      "a same Origin but cross-site Sec-Fetch-Site",
      { Origin: ORIGIN, "Sec-Fetch-Site": "cross-site" },
    ],
    ["Origin: null", { Origin: "null" }],
    ["neither header", {}],
  ])(
    "refuses a POST with %s, even with a valid token",
    async (_name, headers) => {
      const token = await csrfToken(env, ana, NOW);
      await refused(post({ csrf: token }, headers));
    },
  );

  it("refuses a body that is not a form", async () => {
    await refused(
      new Request(`${ORIGIN}/logout`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: "{}",
      }),
    );
  });
});

describe("isSameOrigin", () => {
  it("compares Origin with the request's own origin", () => {
    const at = (origin: string) =>
      new Request(`${ORIGIN}/x`, {
        method: "POST",
        headers: { Origin: origin },
      });
    expect(isSameOrigin(at(ORIGIN))).toBe(true);
    expect(isSameOrigin(at("http://hikebot.example"))).toBe(false);
    expect(isSameOrigin(at("https://hikebot.example:8443"))).toBe(false);
  });
});

describe("CsrfField", () => {
  it("renders the token as a hidden csrf field", async () => {
    const token = await csrfToken(env, ana, NOW);
    const html = await htmlResponse(
      <Layout title="t">
        <form method="post" action="/x">
          <CsrfField token={token} />
        </form>
      </Layout>,
    ).text();
    expect(html).toContain(
      `<input type="hidden" name="csrf" value="${token}"/>`,
    );
  });
});

describe("Layout with a signed-in user", () => {
  it("shows the name and a Sign out form posting the token to /logout", async () => {
    const user = await layoutUser(env, ana, NOW);
    const html = await htmlResponse(
      <Layout title="t" user={user}>
        <p>x</p>
      </Layout>,
    ).text();
    expect(html).toContain(
      '<form class="shell__user" method="post" action="/logout">',
    );
    expect(html).toContain(`name="csrf" value="${user.csrf}"`);
    expect(html).toContain(
      '<button class="button button--quiet" type="submit"><span>Sign out</span></button>',
    );
    expect((await outline(html)).text).toContain("Signed in as Ana.");
  });

  it("shows a name holding markup as text", async () => {
    const user = await layoutUser(
      env,
      { ...ana, name: "<script>alert(1)</script>" },
      NOW,
    );
    const html = await htmlResponse(
      <Layout title="t" user={user}>
        <p>x</p>
      </Layout>,
    ).text();
    const page = await outline(html);
    expect(page.scripts).toBe(0);
    expect(html).toContain("Signed in as &lt;script>alert(1)&lt;/script>.");
  });

  it("has no Sign out form for someone signed out", async () => {
    const html = await htmlResponse(
      <Layout title="t">
        <p>x</p>
      </Layout>,
    ).text();
    expect(html).not.toContain("/logout");
  });
});
