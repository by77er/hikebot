/**
 * The admin controls' routes under `/g/<guild id>/admin/`, through the web
 * router, with a `GUILD_HIKE` binding whose objects answer `webView` with a
 * fixed view and record each `adminAction` call: what every POST checks
 * before the guild object is asked, what it answers for each outcome, and
 * the notice it leaves for the server's page.
 */
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { WebActionResult } from "../../../src/guild/web-action";
import type { WebView, WebViewResult } from "../../../src/guild/web-view";
import { NOTICE_COOKIE } from "../../../src/web/admin/notice";
import { NOT_OFFERED } from "../../../src/web/admin/routes";
import { csrfToken } from "../../../src/web/auth/csrf";
import { sessionCookie, type Session } from "../../../src/web/auth/session";
import { webRouter } from "../../../src/web/routes";
import { outline } from "../helpers";
import {
  adminAction,
  asAdmin,
  baseView,
  GUILD,
  openVote,
  round,
  VIEWER,
} from "../pages/server/view";

const SITE = "https://hikebot.example";
const SESSION: Session = {
  userId: VIEWER,
  name: "Ana",
  avatar: null,
  guilds: [{ id: GUILD, name: "Ridge Walkers", icon: null }],
  issuedAt: Date.now(),
};

/** An admin's view while the location vote is open. */
function votingView(): WebView {
  return asAdmin(
    baseView({
      round: round(
        "location_vote_open",
        openVote("location", [
          { label: "Lake Loop", votes: 2 },
          { label: "Ridge Trail", votes: 1 },
        ]),
      ),
    }),
    [adminAction("close-vote"), adminAction("cancel-round")],
  );
}

/**
 * A binding whose objects answer `webView` with `view` and `adminAction`
 * with `result`.
 */
function guildObjects(
  view: WebView,
  result: WebActionResult = {
    kind: "done",
    notes: [],
    finishing: false,
    retries: [],
  },
) {
  const webView = vi.fn((): Promise<WebViewResult> =>
    Promise.resolve({ kind: "view", view }),
  );
  const act = vi.fn(() => Promise.resolve(result));
  const bindings = {
    ...env,
    GUILD_HIKE: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ webView, adminAction: act })),
    },
  } as unknown as Env;
  return { bindings, webView, act };
}

async function cookie(session: Session = SESSION): Promise<string> {
  return (await sessionCookie(env, session)).split(";")[0] ?? "";
}

function send(path: string, init: RequestInit, bindings: Env) {
  return webRouter.handle(
    new Request(`${SITE}${path}`, init),
    bindings,
    createExecutionContext(),
  );
}

async function post(
  path: string,
  fields: Record<string, string>,
  bindings: Env,
  headers: Record<string, string> = { Origin: SITE },
  session: Session | null = SESSION,
) {
  return send(
    path,
    {
      method: "POST",
      headers: {
        ...(session === null ? {} : { Cookie: await cookie(session) }),
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(fields).toString(),
    },
    bindings,
  );
}

async function token(session: Session = SESSION): Promise<string> {
  return csrfToken(env, session, Date.now());
}

/** The value of the `Set-Cookie` that carries the notice, without its attributes. */
function noticeOf(response: Response): string {
  const set = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${NOTICE_COOKIE}=`));
  if (set === undefined) throw new Error("no notice cookie");
  return set.split(";")[0] ?? "";
}

describe("an admin control's POST", () => {
  const path = `/g/${GUILD}/admin/close-vote`;

  it("runs the control in the guild object as the signed-in user, then redirects with the notice", async () => {
    const { bindings, act } = guildObjects(votingView(), {
      kind: "done",
      notes: [
        "The location vote is closed: **Lake Loop** won with 2 votes.",
        "Could not do something: Discord answered: Missing Access (HTTP 403, code 50001).",
      ],
      finishing: false,
      retries: [],
    });
    const response = await post(
      path,
      { csrf: await token(), target: "1" },
      bindings,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/g/${GUILD}`);
    expect(act).toHaveBeenCalledWith({
      guildId: GUILD,
      userId: VIEWER,
      action: "close-vote",
      target: 1,
      text: null,
    });

    const page = await send(
      `/g/${GUILD}`,
      { headers: { Cookie: `${await cookie()}; ${noticeOf(response)}` } },
      bindings,
    );
    expect(page.status).toBe(200);
    const shown = await outline(await page.text());
    expect(shown.text).toContain("The location vote is closed:");
    expect(shown.text).toContain("Could not do something");
    expect(page.headers.getSetCookie()).toContain(
      `${NOTICE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
    );
  });

  it("is refused with 403 without a session, before the guild object is reached", async () => {
    const { bindings, webView, act } = guildObjects(votingView());
    const response = await post(
      path,
      { target: "1" },
      bindings,
      { Origin: SITE },
      null,
    );
    expect(response.status).toBe(403);
    expect(webView).not.toHaveBeenCalled();
    expect(act).not.toHaveBeenCalled();
  });

  it("is refused with 403 without the token, with another user's, or from another site", async () => {
    const { bindings, act } = guildObjects(votingView());
    const other = await token({ ...SESSION, userId: "400000000000007999" });
    const answers = [
      await post(path, { target: "1" }, bindings),
      await post(path, { csrf: other, target: "1" }, bindings),
      await post(path, { csrf: await token(), target: "1" }, bindings, {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      }),
    ];
    expect(answers.map((r) => r.status)).toEqual([403, 403, 403]);
    expect(act).not.toHaveBeenCalled();
  });

  it("answers a member who is not an admin with the 403 page, without running the control", async () => {
    const view = {
      ...votingView(),
      viewer: { userId: VIEWER, isAdmin: false },
      admin: null,
    };
    const { bindings, act } = guildObjects(view);
    const response = await post(
      path,
      { csrf: await token(), target: "1" },
      bindings,
    );
    expect(response.status).toBe(403);
    expect((await outline(await response.text())).title).toBe(
      "Only admins can do this · hikebot",
    );
    expect(act).not.toHaveBeenCalled();
  });

  it("answers with the 403 page when the guild object finds the user is no admin any more", async () => {
    const { bindings } = guildObjects(votingView(), { kind: "forbidden" });
    const response = await post(
      path,
      { csrf: await token(), target: "1" },
      bindings,
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Only admins can do this");
  });

  it("carries a refusal's sentence to the server's page, saying nothing changed", async () => {
    const { bindings } = guildObjects(votingView(), {
      kind: "refused",
      code: "not_open",
      message: "That vote is no longer open.",
    });
    const response = await post(
      path,
      { csrf: await token(), target: "1" },
      bindings,
    );
    expect(response.status).toBe(303);
    const page = await send(
      `/g/${GUILD}`,
      { headers: { Cookie: `${await cookie()}; ${noticeOf(response)}` } },
      bindings,
    );
    const text = (await outline(await page.text())).text;
    expect(text).toContain("Nothing was changed.");
    expect(text).toContain("That vote is no longer open.");
  });

  it("shows a notice only to the user and on the server it was made for", async () => {
    const { bindings } = guildObjects(votingView(), {
      kind: "refused",
      code: "not_open",
      message: "That vote is no longer open.",
    });
    const response = await post(
      path,
      { csrf: await token(), target: "1" },
      bindings,
    );
    const other: Session = { ...SESSION, userId: "400000000000007998" };
    const page = await send(
      `/g/${GUILD}`,
      { headers: { Cookie: `${await cookie(other)}; ${noticeOf(response)}` } },
      bindings,
    );
    expect(await page.text()).not.toContain("That vote is no longer open.");
  });

  it("answers a path under admin with no control with 404", async () => {
    const { bindings, act } = guildObjects(votingView());
    const response = await post(
      `/g/${GUILD}/admin/nope`,
      { csrf: await token() },
      bindings,
    );
    expect(response.status).toBe(404);
    expect(act).not.toHaveBeenCalled();
  });
});

describe("a start form's POST", () => {
  const path = `/g/${GUILD}/admin/start-location-vote`;
  const view = asAdmin(baseView(), [adminAction("start-location-vote")]);

  it("shows the form again with the panel's sentence and what was typed, for input the modal refuses", async () => {
    const { bindings, act } = guildObjects(view, {
      kind: "refused",
      code: "invalid_labels",
      message: "A location can be at most 80 characters.",
    });
    const response = await post(
      path,
      { csrf: await token(), text: "Ridge Trail\n<b>Lake</b>" },
      bindings,
    );
    expect(response.status).toBe(400);
    const html = await response.text();
    const shown = await outline(html);
    expect(shown.title).toBe(
      "Error: Start location vote · Ridge Walkers · hikebot",
    );
    expect(shown.text).toContain("A location can be at most 80 characters.");
    expect(shown.scripts).toBe(0);
    expect(html).toContain("Ridge Trail\n&lt;b>Lake&lt;/b>");
    expect(act).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Ridge Trail\n<b>Lake</b>" }),
    );
  });

  it("carries other refusals to the server's page", async () => {
    const { bindings } = guildObjects(view, {
      kind: "refused",
      code: "round_active",
      message: "A round is already active.",
    });
    const response = await post(
      path,
      { csrf: await token(), text: "" },
      bindings,
    );
    expect(response.status).toBe(303);
  });
});

describe("the admin pages", () => {
  it("show a confirmation with the tally for a control the view offers", async () => {
    const { bindings, act } = guildObjects(votingView());
    const response = await send(
      `/g/${GUILD}/admin/close-vote?target=1`,
      { headers: { Cookie: await cookie() } },
      bindings,
    );
    expect(response.status).toBe(200);
    const shown = await outline(await response.text());
    expect(shown.title).toBe(
      "Close the location vote now? · Ridge Walkers · hikebot",
    );
    expect(shown.text).toContain("Lake Loop");
    expect(act).not.toHaveBeenCalled();
  });

  it("send the admin back with a notice for a control the round no longer offers", async () => {
    const { bindings } = guildObjects(votingView());
    const response = await send(
      `/g/${GUILD}/admin/close-vote?target=7`,
      { headers: { Cookie: await cookie() } },
      bindings,
    );
    expect(response.status).toBe(303);
    const page = await send(
      `/g/${GUILD}`,
      { headers: { Cookie: `${await cookie()}; ${noticeOf(response)}` } },
      bindings,
    );
    expect(await page.text()).toContain(NOT_OFFERED);
  });

  it("show the start date vote form filled with the default dates", async () => {
    const view = asAdmin(
      baseView({ round: round("location_decided", null, "Lake Loop") }),
      [adminAction("start-date-vote"), adminAction("cancel-round")],
    );
    const { bindings } = guildObjects(view);
    const response = await send(
      `/g/${GUILD}/admin/start-date-vote`,
      { headers: { Cookie: await cookie() } },
      bindings,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      "2030-06-15 11:00\n2030-06-16 11:00</textarea>",
    );
  });

  it("answer a member who is not an admin with the 403 page", async () => {
    const { bindings } = guildObjects(baseView());
    for (const page of ["start-location-vote", "close-vote?target=1"]) {
      const response = await send(
        `/g/${GUILD}/admin/${page}`,
        { headers: { Cookie: await cookie() } },
        bindings,
      );
      expect(response.status).toBe(403);
    }
  });
});
