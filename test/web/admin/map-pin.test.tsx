/**
 * Set map pin's page and POST under `/g/<guild id>/admin/set-map-pin`,
 * through the web router, with a `GUILD_HIKE` binding whose objects answer
 * `webView` with a fixed view and record each `adminAction` call.
 */
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { PIN_UNREADABLE } from "../../../src/features/map-pin";
import type { WebActionResult } from "../../../src/guild/web-action";
import type { WebView, WebViewResult } from "../../../src/guild/web-view";
import { NOTICE_COOKIE } from "../../../src/web/admin/notice";
import { csrfToken } from "../../../src/web/auth/csrf";
import { sessionCookie, type Session } from "../../../src/web/auth/session";
import { webRouter } from "../../../src/web/routes";
import { outline } from "../helpers";
import {
  asAdmin,
  baseView,
  GUILD,
  hikePlace,
  plannedHike,
  VIEWER,
} from "../pages/server/view";

const SITE = "https://hikebot.example";
const PATH = `/g/${GUILD}/admin/set-map-pin`;
const SESSION: Session = {
  userId: VIEWER,
  name: "Ana",
  avatar: null,
  guilds: [{ id: GUILD, name: "Ridge Walkers", icon: null }],
  issuedAt: Date.now(),
};

/** The planned hike without a pin, as a member or an admin sees it. */
function hikeView(admin: boolean, pinnable = true): WebView {
  const view = baseView({
    plannedHike: plannedHike(),
    hikePlace: hikePlace({ pin: null, pinnable }),
  });
  return admin ? asAdmin(view, []) : view;
}

const DONE: WebActionResult = {
  kind: "done",
  notes: ["The map pin of **Mailbox Peak** is set to 47.4875, -121.7234."],
  finishing: false,
  retries: [],
};

function guildObjects(view: WebView, result: WebActionResult = DONE) {
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
  return { bindings, act };
}

async function cookie(session: Session = SESSION): Promise<string> {
  return (await sessionCookie(env, session)).split(";")[0] ?? "";
}

async function get(bindings: Env) {
  return webRouter.handle(
    new Request(`${SITE}${PATH}`, { headers: { Cookie: await cookie() } }),
    bindings,
    createExecutionContext(),
  );
}

async function post(
  fields: Record<string, string>,
  bindings: Env,
  headers: Record<string, string> = { Origin: SITE },
) {
  return webRouter.handle(
    new Request(`${SITE}${PATH}`, {
      method: "POST",
      headers: {
        Cookie: await cookie(),
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(fields).toString(),
    }),
    bindings,
    createExecutionContext(),
  );
}

async function token(session: Session = SESSION): Promise<string> {
  return csrfToken(env, session, Date.now());
}

describe("Set map pin's page", () => {
  it("gives an admin the form, posting the hike's round as its target", async () => {
    const response = await get(guildObjects(hikeView(true)).bindings);
    expect(response.status).toBe(200);
    const html = await response.text();
    const page = await outline(html);
    expect(page.title).toBe("Set map pin · Ridge Walkers · hikebot");
    expect(html).toContain(`action="${PATH}"`);
    expect(html).toContain('name="target" value="12"');
    expect(html).toContain('name="text"');
    expect(page.scripts).toBe(0);
  });

  it("refuses a member who is not an admin", async () => {
    const response = await get(guildObjects(hikeView(false)).bindings);
    expect(response.status).toBe(403);
    expect((await outline(await response.text())).title).toBe(
      "Only admins can do this · hikebot",
    );
  });

  it("sends an admin back when the hike's pin can no longer be set", async () => {
    const response = await get(guildObjects(hikeView(true, false)).bindings);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/g/${GUILD}`);
  });
});

describe("Set map pin's POST", () => {
  it("runs the control in the guild object as the signed-in user, then goes back to the server's page with the notice", async () => {
    const { bindings, act } = guildObjects(hikeView(true));
    const response = await post(
      { csrf: await token(), target: "12", text: "47.4875, -121.7234" },
      bindings,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/g/${GUILD}`);
    expect(response.headers.get("Set-Cookie")).toContain(`${NOTICE_COOKIE}=`);
    expect(act).toHaveBeenCalledWith({
      guildId: GUILD,
      userId: VIEWER,
      action: "set-map-pin",
      target: 12,
      text: "47.4875, -121.7234",
    });
  });

  it("refuses a member who is not an admin without asking the guild object to act", async () => {
    const { bindings, act } = guildObjects(hikeView(false));
    const response = await post(
      { csrf: await token(), target: "12", text: "47.4875, -121.7234" },
      bindings,
    );
    expect(response.status).toBe(403);
    expect(act).not.toHaveBeenCalled();
  });

  it("refuses an admin whom the guild object no longer finds an admin", async () => {
    const { bindings } = guildObjects(hikeView(true), { kind: "forbidden" });
    const response = await post(
      { csrf: await token(), target: "12", text: "47.4875, -121.7234" },
      bindings,
    );
    expect(response.status).toBe(403);
  });

  it("refuses a forged form: no token, another user's token, or another site", async () => {
    const { bindings, act } = guildObjects(hikeView(true));
    const fields = { target: "12", text: "47.4875, -121.7234" };
    expect((await post(fields, bindings)).status).toBe(403);
    const other = await token({ ...SESSION, userId: "400000000000007999" });
    expect((await post({ ...fields, csrf: other }, bindings)).status).toBe(403);
    expect(
      (
        await post({ ...fields, csrf: await token() }, bindings, {
          Origin: "https://evil.example",
          "Sec-Fetch-Site": "cross-site",
        })
      ).status,
    ).toBe(403);
    expect(act).not.toHaveBeenCalled();
  });

  it("comes back as the form, with the panel's sentence and what was typed, when no coordinates can be read", async () => {
    const { bindings } = guildObjects(hikeView(true), {
      kind: "refused",
      code: "unreadable",
      message: PIN_UNREADABLE,
    });
    const response = await post(
      { csrf: await token(), target: "12", text: "<b>somewhere</b>" },
      bindings,
    );
    expect(response.status).toBe(400);
    const html = await response.text();
    const page = await outline(html);
    expect(page.title).toBe("Error: Set map pin · Ridge Walkers · hikebot");
    expect(page.text).toContain("The map pin was not set.");
    expect(page.text).toContain(
      "Enter lat, lon in decimal degrees such as 47.4875, -121.7234",
    );
    expect(html).toContain('value="&lt;b>somewhere&lt;/b>"');
    expect(page.scripts).toBe(0);
  });

  it("leaves another refusal to the notice", async () => {
    const { bindings } = guildObjects(hikeView(true), {
      kind: "refused",
      code: "not_pinnable",
      message: "That hike's location can no longer be pinned from here.",
    });
    const response = await post(
      { csrf: await token(), target: "11", text: "" },
      bindings,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Set-Cookie")).toContain(`${NOTICE_COOKIE}=`);
  });
});
