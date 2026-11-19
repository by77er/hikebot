/**
 * A retry the admin controls offer: the panel's line on the step that
 * failed, then the retry's button, a form that posts to the control's
 * route. The result notice and the admin section both show them.
 */
import type { WebAdminAction } from "../../../features/web-admin";
import type { WebView } from "../../../guild/web-view";
import { TARGET_FIELD } from "../../admin/fields";
import { CsrfField } from "../../auth/csrf";
import { Button } from "../../components/button";
import { NoteText } from "./note-text";

/** The route of an admin's control: `/g/<guild id>/admin/<control>`. */
export function adminPath(guildId: string, kind: string): string {
  return `/g/${guildId}/admin/${kind}`;
}

/**
 * The form that runs `action` at once, as a single button: for the
 * controls that neither ask first nor take input.
 */
export function AdminActionForm({
  view,
  action,
  csrf,
}: {
  view: WebView;
  action: WebAdminAction;
  csrf: string;
}) {
  return (
    <form method="post" action={adminPath(view.server.id, action.kind)}>
      <CsrfField token={csrf} />
      {action.target !== null && (
        <input
          type="hidden"
          name={TARGET_FIELD}
          value={String(action.target)}
        />
      )}
      <Button variant={action.style === "primary" ? "primary" : "secondary"}>
        {action.label}
      </Button>
    </form>
  );
}

export function RetryItem({
  view,
  action,
  csrf,
}: {
  view: WebView;
  action: WebAdminAction;
  csrf: string;
}) {
  return (
    <li class="stack stack--tight">
      {action.note !== null && (
        <p>
          <NoteText text={action.note} view={view} />
        </p>
      )}
      <AdminActionForm view={view} action={action} csrf={csrf} />
    </li>
  );
}
