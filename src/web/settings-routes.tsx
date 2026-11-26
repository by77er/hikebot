/**
 * The server's settings page, `GET /g/<guild id>/settings`, and its forms'
 * target, `POST /g/<guild id>/settings`, for admins only: anyone else who
 * is a member gets the 403 page `AdminOnlyPage`. The page reads the server
 * with its settings forms through `requireServer`; a save goes through
 * `saveGuildSettings`, which decides again in the guild object whether the
 * user is an admin, and checks and makes each change as the admin panel
 * does. A save redirects back to the page with what it did in a cookie,
 * sealed for the user and the server (purpose `settings-saved`), which the
 * page shows once as the group's banner and clears; a refused save answers
 * with the page itself, given what was posted and why it was refused.
 */
import type { Notice } from "../features/settings";
import {
  isSettingGroupId,
  type SettingGroupId,
} from "../features/settings-catalogue";
import type { SettingsFields } from "../features/settings-form";
import { open, seal } from "../signing";
import { clearCookie, readCookie, setCookie } from "./auth/cookies";
import { checkPost, CSRF_FIELD, csrfToken, forbidden } from "./auth/csrf";
import { saveGuildSettings, readGuild } from "./guild";
import { AdminOnlyPage } from "./pages/server/admin-only";
import { DiscordUnavailablePage } from "./pages/server/discord-unavailable";
import { NotMemberPage } from "./pages/server/not-member";
import {
  SettingsPage,
  type SettingsOutcome,
} from "./pages/server/settings/page";
import { seeOther } from "./redirect";
import { htmlResponse } from "./response";
import { requireServer, type ServerRequest } from "./server-guard";

/** The cookie that carries what a save did to the page it redirects to. */
export const SAVED_COOKIE = "__Host-hikebot_settings_saved";
/** How long it waits for its page. */
export const SAVED_TTL_MS = 60_000;

/** What the cookie carries, sealed for purpose `settings-saved`. */
interface SavedPayload {
  /** The guild and user it was saved for, so it shows nowhere else. */
  g: string;
  u: string;
  group: SettingGroupId;
  notices: Notice[];
}

/** The settings page of the server `guildId`. */
export async function settingsPage(
  request: Request,
  env: Env,
  guildId: string,
): Promise<Response> {
  const server = await requireServer(request, env, guildId, {
    settingsForm: true,
  });
  if (server instanceof Response) return server;
  const token = readCookie(request, SAVED_COOKIE);
  const saved =
    token === null
      ? null
      : await open<SavedPayload>(
          env.SIGNING_SECRET,
          "settings-saved",
          token,
          server.now,
        );
  const outcome =
    saved !== null &&
    saved.g === guildId &&
    saved.u === server.session.userId &&
    isSettingGroupId(saved.group)
      ? { group: saved.group, saved: saved.notices }
      : undefined;
  const response = await renderSettings(env, server, outcome);
  if (token !== null) {
    response.headers.append("Set-Cookie", clearCookie(SAVED_COOKIE));
  }
  return response;
}

/** The target of the settings page's forms: saves one group. */
export async function saveSettings(
  request: Request,
  env: Env,
  guildId: string,
): Promise<Response> {
  const server = await requireServer(request, env, guildId);
  if (server instanceof Response) return server;
  const form = await checkPost(request, env, server.session, server.now);
  if (form instanceof Response) return form;
  const group = form.get("group");
  if (!isSettingGroupId(group)) return forbidden();
  const fields: SettingsFields = {};
  for (const [name, value] of form) {
    if (name !== CSRF_FIELD && name !== "group" && typeof value === "string") {
      fields[name] = value;
    }
  }
  const result = await saveGuildSettings(env, {
    guildId,
    userId: server.session.userId,
    group,
    fields,
  });
  switch (result.kind) {
    case "not_member":
      return htmlResponse(<NotMemberPage user={server.user} />, {
        status: 403,
      });
    case "unavailable":
      return unavailable(server, guildId);
    case "forbidden":
      return adminOnly(server, guildId);
    case "saved": {
      const payload: SavedPayload = {
        g: guildId,
        u: server.session.userId,
        group,
        notices: result.notices,
      };
      const token = await seal(
        env.SIGNING_SECRET,
        "settings-saved",
        payload,
        server.now + SAVED_TTL_MS,
      );
      return seeOther(`/g/${guildId}/settings#${group}`, [
        ["Set-Cookie", setCookie(SAVED_COOKIE, token, SAVED_TTL_MS / 1000)],
      ]);
    }
    case "refused": {
      // Read the server again, with what the save left as it was.
      const again = await readGuild(env, guildId, server.session.userId, {
        settingsForm: true,
      });
      if (again.kind !== "view") return unavailable(server, guildId);
      return renderSettings(
        env,
        { ...server, view: again.view },
        { group, fields, errors: result.errors },
        400,
      );
    }
  }
}

/** The page for an admin, or the 403 page for anyone else. */
async function renderSettings(
  env: Env,
  server: ServerRequest,
  outcome: SettingsOutcome | undefined,
  status = 200,
): Promise<Response> {
  const { view } = server;
  if (!view.viewer.isAdmin) return adminOnly(server, view.server.id);
  if (view.settingsForm === null) return unavailable(server, view.server.id);
  return htmlResponse(
    <SettingsPage
      user={server.user}
      view={view}
      form={view.settingsForm}
      csrf={await csrfToken(env, server.session, server.now)}
      outcome={outcome}
    />,
    { status },
  );
}

function adminOnly(server: ServerRequest, guildId: string): Response {
  return htmlResponse(<AdminOnlyPage user={server.user} guildId={guildId} />, {
    status: 403,
  });
}

function unavailable(server: ServerRequest, guildId: string): Response {
  return htmlResponse(
    <DiscordUnavailablePage
      user={server.user}
      retry={`/g/${guildId}/settings`}
    />,
    { status: 503 },
  );
}
