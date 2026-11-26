/**
 * The pages and actions of one server, under `/g/<guild id>`. The web
 * router matches the prefix `/g/*`; the rest of the path picks the page
 * from `SERVER_PAGES`, one entry per page, or from the admin controls'
 * `ADMIN_PAGES`; a POST picks the admin control from `ADMIN_ACTIONS`
 * (`src/web/admin/routes.tsx`), a member's action from `SERVER_ACTIONS`,
 * one entry per form target, or the settings page's save from
 * `SETTINGS_ACTIONS` (`src/web/settings-routes.tsx`). Each page starts with `requireServer`
 * (`src/web/server-guard.tsx`), which signs the user in, checks the
 * session's list and reads the server as its member sees it; each
 * member's action starts with `requireServerAction`, which checks the
 * session, the list, the CSRF token and the origin, then asks the guild
 * object, which checks membership at that moment. A done action redirects
 * back to the server's page with a one-time banner; a refused one answers
 * with the page, the bot's sentence on the form and what was sent kept in
 * it.
 * `/g/<guild id>/map.png` is the planned hike's map picture, the one its
 * thread and event show, which the server's page shows without JavaScript.
 */
import { HIKES_PER_PAGE } from "../features/hike-log";
import type { WebMemberResult, WebProposal } from "../guild/web-action";
import { takeNotice } from "./admin/notice";
import { ADMIN_ACTIONS, ADMIN_PAGES } from "./admin/routes";
import { layoutUser } from "./auth/csrf";
import { flashCookie, takeFlash } from "./flash";
import { proposeInGuild, voteInGuild } from "./guild";
import type { Refusal } from "./pages/server/forms";
import { NotFoundPage } from "./pages/errors";
import { HikeLogPage } from "./pages/server/hike-log-page";
import { PREVIEW_HIKES } from "./pages/server/log-preview";
import { ServerPage } from "./pages/server/page";
import { seeOther } from "./redirect";
import { htmlResponse } from "./response";
import type { WebHandler, WebRouter } from "./router";
import {
  notShown,
  requireServer,
  requireServerAction,
  type ServerAction,
} from "./server-guard";
import { saveSettings, settingsPage } from "./settings-routes";

/** A page of the server `guildId`. */
type ServerPageHandler = (
  request: Request,
  env: Env,
  guildId: string,
) => Promise<Response>;

/** An action on the poll `pollId` of the server `guildId`. */
type ServerActionHandler = (
  request: Request,
  env: Env,
  guildId: string,
  pollId: number,
) => Promise<Response>;

/** The pages by the path after `/g/<guild id>`: "" for the server's page. */
const SERVER_PAGES = new Map<string, ServerPageHandler>([
  ["", serverPage],
  ["/log", hikeLogPage],
  ["/map.png", mapPicture],
  ["/settings", settingsPage],
]);

/** The settings page's save, by the path after `/g/<guild id>`. */
const SETTINGS_ACTIONS = new Map<string, ServerPageHandler>([
  ["/settings", saveSettings],
]);

/** The actions by the path after `/g/<guild id>`, the poll id captured. */
const SERVER_ACTIONS: [RegExp, ServerActionHandler][] = [
  [/^\/polls\/(\d{1,15})\/votes$/, saveVotes],
  [/^\/polls\/(\d{1,15})\/options$/, propose],
];

/** The most characters of one field an action passes on. */
const MAX_FIELD = 4000;

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
  const { flash, headers } = await takeFlash(
    request,
    env,
    server.session,
    guildId,
    server.now,
  );
  if (clear !== null) headers.push(["Set-Cookie", clear]);
  return htmlResponse(
    <ServerPage
      user={server.user}
      view={server.view}
      notice={notice}
      forms={{ csrf: server.user.csrf, refusal: null }}
      flash={flash}
    />,
    { headers },
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

/** Save votes: the member's votes become exactly the ticked options. */
async function saveVotes(
  request: Request,
  env: Env,
  guildId: string,
  pollId: number,
) {
  const action = await requireServerAction(request, env, guildId);
  if (action instanceof Response) return action;
  const optionIds = action.form.getAll("option").map((value) => Number(value));
  const result = await voteInGuild(env, {
    guildId,
    userId: action.session.userId,
    pollId,
    optionIds,
  });
  return answer(request, env, guildId, pollId, action, result, {
    form: "votes",
    optionIds,
  });
}

/**
 * Propose: a past location again (`again`), a date (`date`, `time`) or a
 * new location (`name`, `details`, `map`), by the fields the form sent.
 */
async function propose(
  request: Request,
  env: Env,
  guildId: string,
  pollId: number,
) {
  const action = await requireServerAction(request, env, guildId);
  if (action instanceof Response) return action;
  const { form } = action;
  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === "string" ? value.slice(0, MAX_FIELD) : "";
  };
  let proposal: WebProposal;
  let sent: SentForm;
  if (form.has("again")) {
    const optionId = Number(field("again"));
    proposal = { kind: "again", optionId };
    sent = { form: "again", optionId };
  } else if (form.has("date")) {
    const typed = { date: field("date"), time: field("time") };
    proposal = { kind: "date", ...typed };
    sent = { form: "date", ...typed };
  } else {
    const typed = {
      name: field("name"),
      details: field("details"),
      map: field("map"),
    };
    proposal = { kind: "location", ...typed };
    sent = { form: "location", ...typed };
  }
  const result = await proposeInGuild(env, {
    guildId,
    userId: action.session.userId,
    pollId,
    proposal,
  });
  return answer(request, env, guildId, pollId, action, result, sent);
}

/** A form as it was sent, to show it again with a refusal. */
type SentForm = Refusal extends infer R
  ? R extends Refusal
    ? Omit<R, "pollId" | "message" | "code">
    : never
  : never;

/**
 * Answers an action: done, a redirect back to the server's page that sets
 * its one-time banner; refused, the server's page as it is now, with the
 * bot's sentence and `sent` on the form (422); not a member or Discord
 * unavailable, the guard's pages.
 */
async function answer(
  request: Request,
  env: Env,
  guildId: string,
  pollId: number,
  action: ServerAction,
  result: WebMemberResult,
  sent: SentForm,
): Promise<Response> {
  if (result.kind === "done") {
    const cookie = await flashCookie(
      env,
      action.session,
      guildId,
      { banner: result.banner, note: result.note },
      action.now,
    );
    return seeOther(`/g/${guildId}`, [["Set-Cookie", cookie]]);
  }
  if (result.kind !== "refused") {
    const user = await layoutUser(env, action.session, action.now);
    return notShown(result.kind, user, `/g/${guildId}`);
  }
  const server = await requireServer(request, env, guildId, {
    pageSize: PREVIEW_HIKES,
  });
  if (server instanceof Response) return server;
  const refusal: Refusal = {
    ...sent,
    pollId,
    message: result.message,
    code: result.code,
  };
  return htmlResponse(
    <ServerPage
      user={server.user}
      view={server.view}
      forms={{ csrf: server.user.csrf, refusal }}
    />,
    { status: 422 },
  );
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
 * Adds `/g/*` to `router`, for pages, admin controls' and members'
 * POSTs, answering a path with no page or action with `notFound`.
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
    const control = path && ADMIN_ACTIONS.get(path.rest);
    if (path && control) return control(request, env, path.guildId);
    const settings = path && SETTINGS_ACTIONS.get(path.rest);
    if (path && settings) return settings(request, env, path.guildId);
    if (path) {
      for (const [pattern, action] of SERVER_ACTIONS) {
        const pollId = pattern.exec(path.rest)?.[1];
        if (pollId !== undefined) {
          return action(request, env, path.guildId, Number(pollId));
        }
      }
    }
    return notFound(request, env, ctx);
  });
}
