/**
 * The server's page, after the current step, for an admin only: the
 * round's controls, the same the Discord admin panel (`/hike admin`)
 * offers in this state, with its labels. The round's next step (Start
 * location vote, Close location vote, Start date vote, Close date vote) is
 * the card's one primary button; a retry follows the panel's line on what
 * failed; Withdraw date vote and Cancel round sit apart at the card's foot.
 * A start opens its form page, and a control that asks first (Close,
 * Withdraw, Cancel) its confirmation page; the others post at once. While
 * setup is not complete it says what is missing, as the panel does.
 * Nothing for a member who is not an admin.
 */
import type { WebAdminAction } from "../../../features/web-admin";
import type { WebView } from "../../../guild/web-view";
import type { AdminNotice } from "../../admin/notice";
import { Button } from "../../components/button";
import { Card } from "../../components/card";
import { AdminActionForm, RetryItem, adminPath } from "./admin-retry";
import { offeredRetries } from "./admin-notice";

/** Where a control's button leads: its form or confirmation page, or null to post. */
function pageOf(view: WebView, action: WebAdminAction): string | null {
  const path = adminPath(view.server.id, action.kind);
  if (action.confirm !== null) return `${path}?target=${String(action.target)}`;
  if (
    action.kind === "start-location-vote" ||
    action.kind === "start-date-vote"
  ) {
    return path;
  }
  return null;
}

function ActionButton({
  view,
  action,
  csrf,
}: {
  view: WebView;
  action: WebAdminAction;
  csrf: string;
}) {
  const page = pageOf(view, action);
  if (page === null) {
    return <AdminActionForm view={view} action={action} csrf={csrf} />;
  }
  return (
    <Button variant={action.style} href={page}>
      {action.label}
    </Button>
  );
}

export function AdminControls({
  view,
  notice,
  csrf,
}: {
  view: WebView;
  notice: AdminNotice | null;
  csrf: string;
}) {
  const admin = view.admin;
  if (admin === null) return null;
  const inNotice = offeredRetries(view, notice);
  const shown = (action: WebAdminAction) =>
    !inNotice.some((r) => r.kind === action.kind && r.target === action.target);
  const apart = (action: WebAdminAction) =>
    action.kind === "withdraw-date-vote" || action.kind === "cancel-round";
  const next = admin.actions.filter(
    (action) => action.note === null && !apart(action),
  );
  const retries = admin.actions.filter(
    (action) => action.note !== null && shown(action),
  );
  const last = admin.actions.filter(apart);
  return (
    <Card
      title="Admin"
      footer={
        last.length > 0 ? (
          <div class="cluster">
            {last.map((action) => (
              <ActionButton view={view} action={action} csrf={csrf} />
            ))}
          </div>
        ) : undefined
      }
    >
      <div class="stack">
        <p class="u-muted">
          Only admins see this. These are the controls of /hike admin in
          Discord.
        </p>
        {admin.setupMissing !== null && <p>{admin.setupMissing}</p>}
        {next.length > 0 && (
          <div class="cluster">
            {next.map((action) => (
              <ActionButton view={view} action={action} csrf={csrf} />
            ))}
          </div>
        )}
        {retries.length > 0 && (
          <ul class="stack list-reset" aria-label="Steps to try again">
            {retries.map((action) => (
              <RetryItem view={view} action={action} csrf={csrf} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
