import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebMemberResult } from "../../src/guild/web-action";
import type { WebViewResult } from "../../src/guild/web-view";
import { csrfToken } from "../../src/web/auth/csrf";
import { sessionCookie, type Session } from "../../src/web/auth/session";
import { FLASH_COOKIE } from "../../src/web/flash";
import { webRouter } from "../../src/web/routes";
import { outline } from "./helpers";
import { baseView, openVote, round } from "./pages/server/view";

const GUILD = "200000000000009001";
const OTHER_GUILD = "200000000000009002";
const MEMBER = "400000000000009001";
const OTHER_USER = "400000000000009002";
const ORIGIN = "https://hikebot.example";

afterEach(() => {
  vi.restoreAllMocks();
});

function session(userId = MEMBER, guilds = [GUILD, OTHER_GUILD]): Session {
  return {
    userId,
    name: "Ana",
    avatar: null,
    guilds: guilds.map((id) => ({ id, name: "Ridge Walkers", icon: null })),
    issuedAt: Date.now(),
  };
}

/** The `Cookie` header of `who` signed in. */
async function cookieOf(who: Session = session()): Promise<string> {
  return (await sessionCookie(env, who)).split(";")[0] ?? "";
}

/** A GUILD_HIKE binding whose objects answer with the given results. */
function namespace(
  answers: {
    vote?: WebMemberResult;
    propose?: WebMemberResult;
    view?: WebViewResult;
  } = {},
) {
  const webVote = vi.fn(() => Promise.resolve(answers.vote));
  const webPropose = vi.fn(() => Promise.resolve(answers.propose));
  const webView = vi.fn(() =>
    Promise.resolve(answers.view ?? { kind: "view", view: locationVoteView() }),
  );
  const idFromName = vi.fn((name: string) => name);
  const get = vi.fn(() => ({ webVote, webPropose, webView }));
  const bindings = {
    ...env,
    GUILD_HIKE: { idFromName, get },
  } as unknown as Env;
  return { bindings, webVote, webPropose, webView, idFromName, get };
}

/** The server's view with the location vote open on Lake and Ridge. */
function locationVoteView() {
  return {
    ...baseView({
      round: round(
        "location_vote_open",
        openVote("location", [
          { label: "Lake", votes: 1 },
          { label: "Ridge", votes: 0 },
        ]),
      ),
    }),
    server: { id: GUILD, name: "Ridge Walkers", iconUrl: null },
  };
}

interface PostOptions {
  cookie?: string | null;
  token?: string | null;
  headers?: Record<string, string>;
}

async function post(
  path: string,
  fields: [string, string][],
  bindings: Env,
  options: PostOptions = {},
): Promise<Response> {
  const cookie =
    options.cookie === undefined ? await cookieOf() : options.cookie;
  const token =
    options.token === undefined
      ? await csrfToken(env, session(), Date.now())
      : options.token;
  const body = new URLSearchParams(fields);
  if (token !== null) body.append("csrf", token);
  return webRouter.handle(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: ORIGIN,
        "Sec-Fetch-Site": "same-origin",
        ...(cookie === null ? {} : { Cookie: cookie }),
        ...options.headers,
      },
    }),
    bindings,
    createExecutionContext(),
  );
}

function get(path: string, cookie: string, bindings: Env) {
  return webRouter.handle(
    new Request(`${ORIGIN}${path}`, { headers: { Cookie: cookie } }),
    bindings,
    createExecutionContext(),
  );
}

/** The flash cookie's `name=value` from a response's `Set-Cookie`. */
function flashOf(response: Response): string {
  const line = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${FLASH_COOKIE}=`));
  return line?.split(";")[0] ?? "";
}

const VOTES = `/g/${GUILD}/polls/7/votes`;
const OPTIONS = `/g/${GUILD}/polls/7/options`;

describe("a server's actions refuse a request before it reaches the guild object", () => {
  it.each([
    ["without a session", { cookie: null }, 403],
    ["without a CSRF token", { token: null }, 403],
    ["with another user's CSRF token", { token: "other" }, 403],
    [
      "from another site",
      {
        headers: {
          Origin: "https://evil.example",
          "Sec-Fetch-Site": "cross-site",
        },
      },
      403,
    ],
  ] as [string, PostOptions, number][])(
    "%s",
    async (_name, options, status) => {
      if (options.token === "other") {
        options.token = await csrfToken(env, session(OTHER_USER), Date.now());
      }
      const { bindings, idFromName, get: getStub } = namespace();
      for (const path of [VOTES, OPTIONS]) {
        const response = await post(path, [["option", "1"]], bindings, options);
        expect(response.status).toBe(status);
        expect((await outline(await response.text())).title).toContain(
          "hikebot",
        );
      }
      expect(idFromName).not.toHaveBeenCalled();
      expect(getStub).not.toHaveBeenCalled();
    },
  );

  it("answers a server the session does not list with 404", async () => {
    const { bindings, get: getStub } = namespace();
    const cookie = await cookieOf(session(MEMBER, [OTHER_GUILD]));
    const response = await post(VOTES, [], bindings, { cookie });
    expect(response.status).toBe(404);
    expect(getStub).not.toHaveBeenCalled();
  });

  it("answers a path with no action with 404", async () => {
    const { bindings, get: getStub } = namespace();
    for (const path of [
      `/g/${GUILD}/polls/x/votes`,
      `/g/${GUILD}/polls/7/nope`,
      `/g/${GUILD}`,
    ]) {
      expect((await post(path, [], bindings)).status).toBe(404);
    }
    expect(getStub).not.toHaveBeenCalled();
  });
});

describe("Save votes", () => {
  it("sends the ticked options as the member's votes, then redirects back with a one-time banner", async () => {
    const { bindings, webVote } = namespace({
      vote: { kind: "done", banner: "Your votes are saved.", note: null },
    });
    const response = await post(
      VOTES,
      [
        ["option", "3"],
        ["option", "5"],
      ],
      bindings,
    );
    expect(webVote).toHaveBeenCalledWith({
      guildId: GUILD,
      userId: MEMBER,
      pollId: 7,
      optionIds: [3, 5],
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/g/${GUILD}`);
    const flash = flashOf(response);
    expect(flash).not.toBe("");

    const cookie = `${await cookieOf()}; ${flash}`;
    const page = await get(`/g/${GUILD}`, cookie, bindings);
    expect(page.status).toBe(200);
    expect((await outline(await page.text())).text).toContain(
      "Your votes are saved.",
    );
    expect(page.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(new RegExp(`^${FLASH_COOKIE}=; Max-Age=0`)),
    );

    // A reload, without the cleared cookie, shows no banner.
    const again = await get(`/g/${GUILD}`, await cookieOf(), bindings);
    expect((await outline(await again.text())).text).not.toContain(
      "Your votes are saved.",
    );
  });

  it("sends no options as clearing the votes", async () => {
    const { bindings, webVote } = namespace({
      vote: { kind: "done", banner: "Your votes are cleared.", note: null },
    });
    expect((await post(VOTES, [], bindings)).status).toBe(303);
    expect(webVote).toHaveBeenCalledWith(
      expect.objectContaining({ optionIds: [] }),
    );
  });

  it("answers a refusal with the page, the bot's sentence and the boxes as sent", async () => {
    const { bindings } = namespace({
      vote: {
        kind: "refused",
        code: "unknown_option",
        message: "That option is not in this poll.",
      },
      view: {
        kind: "view",
        view: {
          ...locationVoteView(),
          round: {
            ...round("location_vote_open", null),
            vote: {
              ...openVote("location", [{ label: "Lake", votes: 0 }]),
              pollId: 7,
            },
          },
        },
      },
    });
    const response = await post(VOTES, [["option", "1"]], bindings);
    expect(response.status).toBe(422);
    const html = await response.text();
    const page = await outline(html);
    expect(page.title).toBe("Error: Ridge Walkers · hikebot");
    expect(page.text).toContain("Your votes were not saved.");
    expect(page.text).toContain("That option is not in this poll.");
    expect(html).toMatch(/name="option" value="1" checked/);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("shows a vote that closed since the page loaded at the top of the page", async () => {
    const { bindings } = namespace({
      vote: {
        kind: "refused",
        code: "poll_closed",
        message: "This vote has closed.",
      },
      view: {
        kind: "view",
        view: {
          ...locationVoteView(),
          round: round("location_decided", null, "Lake"),
        },
      },
    });
    const response = await post(VOTES, [["option", "1"]], bindings);
    expect(response.status).toBe(422);
    const text = (await outline(await response.text())).text;
    expect(text).toContain("This vote has closed.");
    expect(text).toContain("won the location vote.");
  });

  it("answers a member who left with the not-a-member page, and Discord down with try again", async () => {
    const left = namespace({ vote: { kind: "not_member" } });
    const gone = await post(VOTES, [], left.bindings);
    expect(gone.status).toBe(403);
    expect((await outline(await gone.text())).text).toContain(
      "You are not a member of this server any more",
    );
    expect(left.webView).not.toHaveBeenCalled();
    const down = namespace({ vote: { kind: "unavailable" } });
    const later = await post(VOTES, [], down.bindings);
    expect(later.status).toBe(503);
    expect(await later.text()).toContain(`href="/g/${GUILD}"`);
  });
});

describe("Propose", () => {
  it.each([
    [
      "a new location",
      [
        ["name", "Lake"],
        ["details", "Loop"],
        ["map", "47.5, -121.7"],
      ],
      { kind: "location", name: "Lake", details: "Loop", map: "47.5, -121.7" },
    ],
    [
      "a past location again",
      [["again", "12"]],
      { kind: "again", optionId: 12 },
    ],
    [
      "a date",
      [
        ["date", "2030-06-08"],
        ["time", ""],
      ],
      { kind: "date", date: "2030-06-08", time: "" },
    ],
  ] as [string, [string, string][], unknown][])(
    "sends %s as the member's proposal",
    async (_name, fields, proposal) => {
      const { bindings, webPropose } = namespace({
        propose: { kind: "done", banner: "Added Lake.", note: "A note." },
      });
      const response = await post(OPTIONS, fields, bindings);
      expect(webPropose).toHaveBeenCalledWith({
        guildId: GUILD,
        userId: MEMBER,
        pollId: 7,
        proposal,
      });
      expect(response.status).toBe(303);
      const page = await get(
        `/g/${GUILD}`,
        `${await cookieOf()}; ${flashOf(response)}`,
        bindings,
      );
      const text = (await outline(await page.text())).text;
      expect(text).toContain("Added Lake.");
      expect(text).toContain("A note.");
    },
  );

  it("answers a refusal with the bot's sentence on the form and what was typed kept", async () => {
    const view = locationVoteView();
    const vote = view.round?.vote;
    const { bindings } = namespace({
      propose: {
        kind: "refused",
        code: "duplicate_option",
        message: "**Lake** is already on the list. Vote for it instead.",
      },
      view: {
        kind: "view",
        view: {
          ...view,
          round: vote
            ? { ...round("location_vote_open", { ...vote, pollId: 7 }) }
            : null,
        },
      },
    });
    const response = await post(
      OPTIONS,
      [
        ["name", "Lake"],
        ["details", "<b>Loop</b>"],
        ["map", ""],
      ],
      bindings,
    );
    expect(response.status).toBe(422);
    const html = await response.text();
    expect(html).toContain(
      "<strong>Lake</strong> is already on the list. Vote for it instead.",
    );
    expect(html).toContain("Your location was not added.");
    expect(html).toMatch(
      /id="new-location-name" name="name" type="text" value="Lake"/,
    );
    expect(html).toContain("&lt;b>Loop&lt;/b></textarea>");
    expect((await outline(html)).scripts).toBe(0);
  });
});

describe("the one-time banner", () => {
  it("is not shown to another user, and is left for its own server", async () => {
    const { bindings } = namespace({
      vote: { kind: "done", banner: "Your votes are saved.", note: null },
    });
    const flash = flashOf(await post(VOTES, [], bindings));

    const other = await get(
      `/g/${GUILD}`,
      `${await cookieOf(session(OTHER_USER))}; ${flash}`,
      bindings,
    );
    expect((await outline(await other.text())).text).not.toContain(
      "Your votes are saved.",
    );
    expect(other.headers.getSetCookie()).toHaveLength(1);

    const elsewhere = await get(
      `/g/${OTHER_GUILD}`,
      `${await cookieOf()}; ${flash}`,
      bindings,
    );
    expect((await outline(await elsewhere.text())).text).not.toContain(
      "Your votes are saved.",
    );
    expect(elsewhere.headers.getSetCookie()).toEqual([]);
  });
});
