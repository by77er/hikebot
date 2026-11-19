/**
 * A server's page at `/g/<guild id>`: what a member sees after choosing the
 * server. It only composes the page's sections, in a fixed order, one line
 * each; each section is a component in its own file in this directory that
 * takes the view and decides for itself whether it shows anything. "Add a
 * section to the server's page" in src/web/AGENTS.md says how to add one.
 */
import type { WebView } from "../../../guild/web-view";
import type { AdminNotice } from "../../admin/notice";
import type { Flash } from "../../flash";
import { Layout, type LayoutUser } from "../../layout";
import { ActionNotice } from "./action-notice";
import { AdminControls } from "./admin-controls";
import { AdminNoticeBanner } from "./admin-notice";
import { CalendarAddress } from "./calendar-address";
import { CurrentStep } from "./current-step";
import { HikeForecast } from "./hike-forecast";
import { HikePlace } from "./hike-place";
import type { PageForms } from "./forms";
import { LogPreview } from "./log-preview";
import { PlannedHike } from "./planned-hike";
import { ProposeDate } from "./propose-date";
import { ProposeLocation } from "./propose-location";
import { ScheduleLine } from "./schedule-line";
import { ServerHeading } from "./server-heading";

export function ServerPage({
  user,
  view,
  notice = null,
  forms,
  flash = null,
}: {
  user: LayoutUser;
  view: WebView;
  /** What an admin's action just came to, from its redirect. */
  notice?: AdminNotice | null;
  /** The forms' CSRF token, and a member's refused action to show. */
  forms: PageForms;
  /** The banner of the member's last action, shown once. */
  flash?: Flash | null;
}) {
  const title = `${view.server.name} · hikebot`;
  return (
    <Layout
      title={forms.refusal === null ? title : `Error: ${title}`}
      user={user}
    >
      <div class="stack stack--section">
        <ServerHeading view={view} />
        <AdminNoticeBanner view={view} notice={notice} csrf={user.csrf} />
        <ActionNotice view={view} forms={forms} flash={flash} />
        <CurrentStep view={view} forms={forms} />
        <AdminControls view={view} notice={notice} csrf={user.csrf} />
        <ProposeLocation view={view} forms={forms} />
        <ProposeDate view={view} forms={forms} />
        <PlannedHike view={view} />
        <HikePlace view={view} csrf={user.csrf} />
        <HikeForecast view={view} />
        <ScheduleLine view={view} />
        <LogPreview view={view} />
        <CalendarAddress view={view} />
      </div>
    </Layout>
  );
}
