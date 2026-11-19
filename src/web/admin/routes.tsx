/**
 * The admin controls' routes under `/g/<guild id>/admin/`, by the path
 * after `/g/<guild id>`: the pages (`ADMIN_PAGES`: the two start forms and
 * the confirmations) and the POST of every control (`ADMIN_ACTIONS`). Each
 * page starts with `requireAdmin` and each POST is `adminAction`
 * (`action.tsx`); "Add an admin action to a server's page" in
 * src/web/AGENTS.md says how to add one.
 */
import type {
  WebAdminAction,
  WebAdminActionKind,
} from "../../features/web-admin";
import { AdminConfirmPage } from "../pages/server/admin/confirm";
import {
  StartVotePage,
  type StartKind,
} from "../pages/server/admin/start-vote";
import { seeOther } from "../redirect";
import { htmlResponse } from "../response";
import {
  adminAction,
  requireAdmin,
  type AdminRefusal,
  type AdminRequest,
} from "./action";
import { TEXT_FIELD } from "./fields";
import { mapPinAction, mapPinPage } from "./map-pin";
import { noticeCookie } from "./notice";

/** A page or POST of the server `guildId`. */
type AdminHandler = (
  request: Request,
  env: Env,
  guildId: string,
) => Promise<Response>;

/** The sentence for a page whose control the round no longer offers. */
export const NOT_OFFERED =
  "That control is no longer offered: the round has moved on since the page was loaded.";

/** Back to the server's page, saying the control is no longer offered. */
export async function notOffered(
  env: Env,
  admin: AdminRequest,
  guildId: string,
): Promise<Response> {
  return seeOther(`/g/${guildId}`, [
    [
      "Set-Cookie",
      await noticeCookie(
        env,
        admin.session.userId,
        guildId,
        { kind: "refused", lines: [NOT_OFFERED], retries: [] },
        admin.now,
      ),
    ],
  ]);
}

/** The control `kind` the view offers, for `target` when given. */
function offered(
  admin: AdminRequest,
  kind: WebAdminActionKind,
  target?: string | null,
): WebAdminAction | undefined {
  return admin.admin.actions.find(
    (action) =>
      action.kind === kind &&
      (target === undefined || String(action.target) === target),
  );
}

/** The field a start form shows, and what it holds at first. */
function startField(admin: AdminRequest, kind: StartKind) {
  return kind === "start-location-vote"
    ? { field: admin.admin.locationsField, value: "" }
    : {
        field: admin.admin.datesField,
        value: admin.admin.datesField.value.join("\n"),
      };
}

function startPage(kind: StartKind): AdminHandler {
  return async (request, env, guildId) => {
    const admin = await requireAdmin(request, env, guildId);
    if (admin instanceof Response) return admin;
    if (!offered(admin, kind)) return notOffered(env, admin, guildId);
    const { field, value } = startField(admin, kind);
    return htmlResponse(
      <StartVotePage
        user={admin.user}
        view={admin.view}
        kind={kind}
        field={field}
        csrf={admin.csrf}
        typed={value}
      />,
    );
  };
}

function confirmPage(kind: WebAdminActionKind): AdminHandler {
  return async (request, env, guildId) => {
    const admin = await requireAdmin(request, env, guildId);
    if (admin instanceof Response) return admin;
    const target = new URL(request.url).searchParams.get("target");
    const action = offered(admin, kind, target);
    if (!action) return notOffered(env, admin, guildId);
    return htmlResponse(
      <AdminConfirmPage
        user={admin.user}
        view={admin.view}
        action={action}
        csrf={admin.csrf}
      />,
    );
  };
}

/** The refusals a start form shows at its field, with what was typed. */
const FORM_REFUSALS = new Set([
  "invalid_labels",
  "resting",
  "invalid_dates",
  "refused",
]);

function startAction(kind: StartKind): AdminHandler {
  return (request, env, guildId) =>
    adminAction(request, env, guildId, {
      action: kind,
      refused: (refusal: AdminRefusal, admin: AdminRequest, form: FormData) => {
        if (!FORM_REFUSALS.has(refusal.code)) return null;
        const typed = form.get(TEXT_FIELD);
        return htmlResponse(
          <StartVotePage
            user={admin.user}
            view={admin.view}
            kind={kind}
            field={startField(admin, kind).field}
            csrf={admin.csrf}
            typed={typeof typed === "string" ? typed : ""}
            error={refusal.message}
          />,
          { status: 400 },
        );
      },
    });
}

function action(kind: WebAdminActionKind): AdminHandler {
  return (request, env, guildId) =>
    adminAction(request, env, guildId, { action: kind });
}

/** The admin pages by the path after `/g/<guild id>`. */
export const ADMIN_PAGES = new Map<string, AdminHandler>([
  ["/admin/start-location-vote", startPage("start-location-vote")],
  ["/admin/start-date-vote", startPage("start-date-vote")],
  ["/admin/close-vote", confirmPage("close-vote")],
  ["/admin/withdraw-date-vote", confirmPage("withdraw-date-vote")],
  ["/admin/cancel-round", confirmPage("cancel-round")],
  ["/admin/set-map-pin", mapPinPage],
]);

/** The admin controls' POSTs by the path after `/g/<guild id>`. */
export const ADMIN_ACTIONS = new Map<string, AdminHandler>([
  ["/admin/start-location-vote", startAction("start-location-vote")],
  ["/admin/start-date-vote", startAction("start-date-vote")],
  ["/admin/close-vote", action("close-vote")],
  ["/admin/withdraw-date-vote", action("withdraw-date-vote")],
  ["/admin/cancel-round", action("cancel-round")],
  ["/admin/post-vote-message", action("post-vote-message")],
  ["/admin/create-hike-thread", action("create-hike-thread")],
  ["/admin/create-hike-event", action("create-hike-event")],
  ["/admin/show-map-picture", action("show-map-picture")],
  ["/admin/post-hike-day", action("post-hike-day")],
  ["/admin/announce", action("announce")],
  ["/admin/set-map-pin", mapPinAction],
]);
