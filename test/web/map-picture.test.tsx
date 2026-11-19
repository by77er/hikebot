import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebViewResult } from "../../src/guild/web-view";
import { sessionCookie } from "../../src/web/auth/session";
import { webRouter } from "../../src/web/routes";
import { clearBucket } from "../maps/helpers";
import { outline } from "./helpers";
import { baseView, GUILD, plannedHike, VIEWER } from "./pages/server/view";

const KEY = "pictures/test/mailbox.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PATH = `/g/${GUILD}/map.png`;

async function signedIn(guilds: string[] = [GUILD]): Promise<string> {
  const cookie = await sessionCookie(env, {
    userId: VIEWER,
    name: "Ana",
    avatar: null,
    guilds: guilds.map((id) => ({ id, name: "Ridge Walkers", icon: null })),
    issuedAt: Date.now(),
  });
  return cookie.split(";")[0] ?? "";
}

/** The env with a GUILD_HIKE whose objects answer `webView` with `result`. */
function answering(result: WebViewResult) {
  const webView = vi.fn(() => Promise.resolve(result));
  const idFromName = vi.fn((name: string) => name);
  const bindings = {
    ...env,
    GUILD_HIKE: { idFromName, get: vi.fn(() => ({ webView })) },
  } as unknown as Env;
  return { bindings, webView, idFromName };
}

function withPicture(key: string | null): WebViewResult {
  return {
    kind: "view",
    view: baseView({
      plannedHike: plannedHike({
        mapPictureKey: key,
        point: { lat: 47.5, lon: -121.7 },
      }),
    }),
  };
}

function get(bindings: Env, headers: HeadersInit = {}) {
  return webRouter.handle(
    new Request(`https://hikebot.example${PATH}`, { headers }),
    bindings,
    createExecutionContext(),
  );
}

beforeEach(async () => {
  await clearBucket();
  await env.MAPS.put(KEY, PNG);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /g/<guild id>/map.png", () => {
  it("serves a member the planned hike's stored picture", async () => {
    const { bindings } = answering(withPicture(KEY));
    const response = await get(bindings, { Cookie: await signedIn() });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);

    const etag = response.headers.get("ETag") ?? "";
    expect(etag).not.toBe("");
    const again = await get(bindings, {
      Cookie: await signedIn(),
      "If-None-Match": etag,
    });
    expect(again.status).toBe(304);
  });

  it("refuses someone who is not a member any more", async () => {
    const { bindings } = answering({ kind: "not_member" });
    const response = await get(bindings, { Cookie: await signedIn() });
    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("sends someone signed out to sign in, and turns away a server the session does not list without reaching its object", async () => {
    const { bindings, idFromName } = answering(withPicture(KEY));
    const signedOut = await get(bindings);
    expect(signedOut.status).toBe(303);
    const other = await get(bindings, {
      Cookie: await signedIn(["200000000000007999"]),
    });
    expect(other.status).toBe(404);
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("is the 404 page while the hike has no picture, or the bucket lost it", async () => {
    for (const result of [
      withPicture(null),
      withPicture("pictures/test/gone.png"),
      { kind: "view", view: baseView() } as const,
    ]) {
      const { bindings } = answering(result);
      const response = await get(bindings, { Cookie: await signedIn() });
      expect(response.status).toBe(404);
      expect((await outline(await response.text())).title).toBe(
        "Page not found · hikebot",
      );
    }
  });
});
