/**
 * The pages of one server, under `/g/<guild id>`. The web router matches
 * the prefix `/g/*`; the rest of the path picks the page from
 * `SERVER_PAGES`, one entry per page. Each page starts with `requireServer`
 * (`src/web/server-guard.tsx`), which signs the user in, checks the
 * session's list and reads the server as its member sees it.
 */
import { HIKES_PER_PAGE } from "../features/hike-log";
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
]);

async function serverPage(request: Request, env: Env, guildId: string) {
  const server = await requireServer(request, env, guildId, {
    pageSize: PREVIEW_HIKES,
  });
  if (server instanceof Response) return server;
  return htmlResponse(<ServerPage user={server.user} view={server.view} />);
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

/** `/g/<guild id><rest>` split, or null for a path of no server. */
function serverPath(
  pathname: string,
): { guildId: string; rest: string } | null {
  const match = /^\/g\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match?.[1]) return null;
  return { guildId: match[1], rest: match[2] ?? "" };
}

/** Adds `/g/*` to `router`, answering a path with no page with `notFound`. */
export function addServerRoutes(router: WebRouter, notFound: WebHandler): void {
  router.get("/g/*", (request, env, ctx) => {
    const path = serverPath(new URL(request.url).pathname);
    const page = path && SERVER_PAGES.get(path.rest);
    if (!path || !page) return notFound(request, env, ctx);
    return page(request, env, path.guildId);
  });
}
