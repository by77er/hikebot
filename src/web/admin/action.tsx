/**
 * What every admin action of a server's page shares; "Add an admin action
 * to a server's page" in src/web/AGENTS.md shows it in use.
 *
 * - `requireAdmin` guards an admin's page under `/g/<guild id>/admin/` (a
 *   start form, a confirmation): `requireServer`, then the 403 page "Only
 *   admins can do this" for a member who is not an admin.
 * - `adminAction` answers an admin's POST: `requireServer` (signed out: the
 *   403 refused page), `checkPost` (the CSRF token and the same origin),
 *   the view's admin flag, then the control, run in the guild object by
 *   `actOnGuild`, which asks Discord again whether the user is an admin at
 *   this moment and calls the round action. The answer is a redirect (303)
 *   to the server's page carrying the notice (`notice.ts`): the panel's
 *   notes, or its refusal's sentence.
 *
 * Nothing here decides what an action may do: that is the round action's.
 */
import type {
  WebAdminActionKind,
  WebAdminSection,
} from "../../features/web-admin";
import { checkPost, csrfToken } from "../auth/csrf";
import { actOnGuild } from "../guild";
import type { LayoutUser } from "../layout";
import { AdminOnlyPage } from "../pages/server/admin-only";
import { DiscordUnavailablePage } from "../pages/server/discord-unavailable";
import { NotMemberPage } from "../pages/server/not-member";
import { seeOther } from "../redirect";
import { htmlResponse } from "../response";
import { requireServer, type ServerRequest } from "../server-guard";
import { TARGET_FIELD, TEXT_FIELD } from "./fields";
import { noticeCookie, type AdminNotice } from "./notice";

/** An admin's page or action once the guard lets it through. */
export interface AdminRequest extends ServerRequest {
  /** The view's admin section. */
  admin: WebAdminSection;
  /** A CSRF token for the page's forms. */
  csrf: string;
}

/** The 403 page for a member who is not an admin. */
export function adminOnly(user: LayoutUser, guildId: string): Response {
  return htmlResponse(<AdminOnlyPage user={user} guildId={guildId} />, {
    status: 403,
  });
}

/**
 * The server `guildId` for an admin's page, or the response that answers
 * instead: `requireServer`'s, or the 403 page for a member who is not an
 * admin.
 */
export async function requireAdmin(
  request: Request,
  env: Env,
  guildId: string,
): Promise<AdminRequest | Response> {
  const server = await requireServer(request, env, guildId);
  if (server instanceof Response) return server;
  const admin = server.view.admin;
  if (admin === null) return adminOnly(server.user, guildId);
  return {
    ...server,
    admin,
    csrf: await csrfToken(env, server.session, server.now),
  };
}

/** A round action's refusal, as the guild object answered it. */
export interface AdminRefusal {
  code: string;
  message: string;
}

export interface AdminActionOptions {
  /** The control the route runs. */
  action: WebAdminActionKind;
  /**
   * Answers a refusal itself, such as a start form shown again with the
   * error and what was typed; returns null to leave it to the notice.
   */
  refused?: (
    refusal: AdminRefusal,
    admin: AdminRequest,
    form: FormData,
  ) => Response | null;
}

function targetOf(form: FormData): number | null {
  const value = form.get(TARGET_FIELD);
  if (typeof value !== "string" || !/^\d{1,15}$/.test(value)) return null;
  return Number(value);
}

function textOf(form: FormData): string | null {
  const value = form.get(TEXT_FIELD);
  return typeof value === "string" ? value : null;
}

/** Runs the admin's POST `request` for the control `options.action`. */
export async function adminAction(
  request: Request,
  env: Env,
  guildId: string,
  options: AdminActionOptions,
): Promise<Response> {
  const server = await requireServer(request, env, guildId);
  if (server instanceof Response) return server;
  const form = await checkPost(request, env, server.session, server.now);
  if (form instanceof Response) return form;
  const admin = server.view.admin;
  if (admin === null) return adminOnly(server.user, guildId);
  const result = await actOnGuild(env, guildId, server.session.userId, {
    action: options.action,
    target: targetOf(form),
    text: textOf(form),
  });
  let notice: AdminNotice;
  switch (result.kind) {
    case "forbidden":
      return adminOnly(server.user, guildId);
    case "not_member":
      return htmlResponse(<NotMemberPage user={server.user} />, {
        status: 403,
      });
    case "unavailable":
      return htmlResponse(
        <DiscordUnavailablePage user={server.user} retry={`/g/${guildId}`} />,
        { status: 503 },
      );
    case "refused": {
      const own = options.refused?.(
        result,
        {
          ...server,
          admin,
          csrf: await csrfToken(env, server.session, server.now),
        },
        form,
      );
      if (own) return own;
      notice = {
        kind: "refused",
        lines: result.message.split("\n"),
        retries: [],
      };
      break;
    }
    case "done":
      notice = {
        kind: result.finishing ? "finishing" : "done",
        lines: result.notes,
        retries: result.retries,
      };
      break;
  }
  return seeOther(`/g/${guildId}`, [
    [
      "Set-Cookie",
      await noticeCookie(
        env,
        server.session.userId,
        guildId,
        notice,
        server.now,
      ),
    ],
  ]);
}
