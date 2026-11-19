/**
 * The guard every page and action under `/g/<guild id>` starts with. It
 * turns the request into the server's view, or into the page that answers
 * instead:
 *
 * 1. signed out: a page (GET) redirects to sign in and back; an action
 *    (POST) is refused, since a form cannot be sent again after sign-in;
 * 2. a server the session does not list: the 404 page, without reaching
 *    the server's guild object;
 * 3. the read (`readGuild`), which checks with the bot's token that the user
 *    is still a member and decides whether they are an admin: not a member
 *    gets `NotMemberPage`, and Discord not answering gets
 *    `DiscordUnavailablePage`, neither showing anything of the server.
 *
 * "Web pages for a server" in docs/design.md describes it.
 */
import { systemNow } from "../clock";
import type { WebView } from "../guild/web-view";
import { forbidden, layoutUser } from "./auth/csrf";
import {
  readSession,
  requireGuild,
  requireSession,
  type Session,
} from "./auth/session";
import { readGuild } from "./guild";
import type { LayoutUser } from "./layout";
import { DiscordUnavailablePage } from "./pages/server/discord-unavailable";
import { NotMemberPage } from "./pages/server/not-member";
import { htmlResponse } from "./response";

/** What a page or action of a server gets once the guard lets it through. */
export interface ServerRequest {
  session: Session;
  /** The clock, read once for the request. */
  now: number;
  /** The signed-in user, for `Layout`. */
  user: LayoutUser;
  /** The server as its member sees it, from `readGuild`. */
  view: WebView;
}

/**
 * The server `guildId` as the signed-in member sees it, or the response
 * that answers the request instead. `read` picks the page of the hike log
 * the view carries and asks for the settings page's forms, as `readGuild`
 * takes them. A page or action starts with:
 *
 * ```ts
 * const server = await requireServer(request, env, guildId);
 * if (server instanceof Response) return server;
 * ```
 */
export async function requireServer(
  request: Request,
  env: Env,
  guildId: string,
  read: { page?: number; pageSize?: number; settingsForm?: boolean } = {},
): Promise<ServerRequest | Response> {
  const now = systemNow();
  const isPage = request.method === "GET" || request.method === "HEAD";
  const session = isPage
    ? await requireSession(request, env, now)
    : ((await readSession(request, env, now)) ?? forbidden());
  if (session instanceof Response) return session;
  const listed = requireGuild(session, guildId);
  if (listed instanceof Response) return listed;
  const result = await readGuild(env, guildId, session.userId, read);
  const user = await layoutUser(env, session, now);
  if (result.kind === "not_member") {
    return htmlResponse(<NotMemberPage user={user} />, { status: 403 });
  }
  if (result.kind === "unavailable") {
    const url = new URL(request.url);
    const retry = isPage ? url.pathname + url.search : `/g/${guildId}`;
    return htmlResponse(<DiscordUnavailablePage user={user} retry={retry} />, {
      status: 503,
    });
  }
  return { session, now, user, view: result.view };
}
