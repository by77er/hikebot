/**
 * The pages of one server, under `/g/<guild id>`. The web router matches
 * the prefix `/g/*`; the rest of the path picks the page from
 * `SERVER_PAGES`, one entry per page, or from the admin controls'
 * `ADMIN_PAGES`; a POST picks the admin control from `ADMIN_ACTIONS`
 * (`src/web/admin/routes.tsx`). Each page starts with `requireServer`
 * (`src/web/server-guard.tsx`), which signs the user in, checks the
 * session's list and reads the server as its member sees it.
 * `/g/<guild id>/map.png` is the planned hike's map picture, the one its
 * thread and event show, which the server's page shows without JavaScript.
 */
import { HIKES_PER_PAGE } from "../features/hike-log";
import { takeNotice } from "./admin/notice";
import { ADMIN_ACTIONS, ADMIN_PAGES } from "./admin/routes";
import { NotFoundPage } from "./pages/errors";
import { HikeLogPage } from "./pages/server/hike-log-page";
import { PREVIEW_HIKES } from "./pages/server/log-preview";
import { ServerPage } from "./pages/server/page";
import { htmlResponse } from "./response";
import type { WebHandler, WebRouter } from "./router";
import { requireServer } from "./server-guard";

/** A page of the server `guildId`. */
type ServerPageHandler = (
  request: Request,
  env: Env,
  guildId: string,
) => Promise<Response>;

/** The pages by the path after `/g/<guild id>`: "" for the server's page. */
const SERVER_PAGES = new Map<string, ServerPageHandler>([
  ["", serverPage],
  ["/log", hikeLogPage],
  ["/map.png", mapPicture],
]);

async function serverPage(request: Request, env: Env, guildId: string) {
  const server = await requireServer(request, env, guildId, {
    pageSize: PREVIEW_HIKES,
  });
  if (server instanceof Response) return server;
  const { notice, clear } = await takeNotice(
    request,
    env,
    server.session.userId,
    guildId,
    server.now,
  );
  return htmlResponse(
    <ServerPage user={server.user} view={server.view} notice={notice} />,
    clear === null ? {} : { headers: { "Set-Cookie": clear } },
  );
}

async function hikeLogPage(request: Request, env: Env, guildId: string) {
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  const server = await requireServer(request, env, guildId, {
    page: Number.isInteger(page) ? page : 1,
    pageSize: HIKES_PER_PAGE,
  });
  if (server instanceof Response) return server;
  return htmlResponse(<HikeLogPage user={server.user} view={server.view} />);
}

/**
 * The planned hike's map picture from the `MAPS` bucket, for members only;
 * the 404 page while there is none. Browsers check it again on every use
 * (`no-cache` and the object's ETag), since a moved pin keeps the address.
 */
async function mapPicture(request: Request, env: Env, guildId: string) {
  const server = await requireServer(request, env, guildId, { pageSize: 1 });
  if (server instanceof Response) return server;
  const key = server.view.plannedHike?.mapPictureKey ?? null;
  const picture = key === null ? null : await env.MAPS.get(key);
  if (picture === null) {
    return htmlResponse(<NotFoundPage />, { status: 404 });
  }
  const headers = {
    "Content-Type": "image/png",
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    ETag: picture.httpEtag,
  };
  if (request.headers.get("If-None-Match") === picture.httpEtag) {
    await picture.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  return new Response(picture.body, { headers });
}

/** `/g/<guild id><rest>` split, or null for a path of no server. */
function serverPath(
  pathname: string,
): { guildId: string; rest: string } | null {
  const match = /^\/g\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match?.[1]) return null;
  return { guildId: match[1], rest: match[2] ?? "" };
}

/**
 * Adds `/g/*` to `router`, for pages and admin controls' POSTs, answering
 * a path with no page or control with `notFound`.
 */
export function addServerRoutes(router: WebRouter, notFound: WebHandler): void {
  router.get("/g/*", (request, env, ctx) => {
    const path = serverPath(new URL(request.url).pathname);
    const page =
      path && (SERVER_PAGES.get(path.rest) ?? ADMIN_PAGES.get(path.rest));
    if (!path || !page) return notFound(request, env, ctx);
    return page(request, env, path.guildId);
  });
  router.post("/g/*", (request, env, ctx) => {
    const path = serverPath(new URL(request.url).pathname);
    const action = path && ADMIN_ACTIONS.get(path.rest);
    if (!path || !action) return notFound(request, env, ctx);
    return action(request, env, path.guildId);
  });
}
