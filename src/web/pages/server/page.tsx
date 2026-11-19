/**
 * A server's page at `/g/<guild id>`: what a member sees after choosing the
 * server. It only composes the page's sections, in a fixed order, one line
 * each; each section is a component in its own file in this directory that
 * takes the view and decides for itself whether it shows anything. "Add a
 * section to the server's page" in src/web/AGENTS.md says how to add one.
 */
import type { WebView } from "../../../guild/web-view";
import type { AdminNotice } from "../../admin/notice";
import { Layout, type LayoutUser } from "../../layout";
import { AdminControls } from "./admin-controls";
import { AdminNoticeBanner } from "./admin-notice";
import { CalendarAddress } from "./calendar-address";
import { CurrentStep } from "./current-step";
import { LogPreview } from "./log-preview";
import { PlannedHike } from "./planned-hike";
import { ServerHeading } from "./server-heading";

export function ServerPage({
  user,
  view,
  notice = null,
}: {
  user: LayoutUser;
  view: WebView;
  /** What an admin's action just came to, from its redirect. */
  notice?: AdminNotice | null;
}) {
  return (
    <Layout title={`${view.server.name} · hikebot`} user={user}>
      <div class="stack stack--section">
        <ServerHeading view={view} />
        <AdminNoticeBanner view={view} notice={notice} csrf={user.csrf} />
        <CurrentStep view={view} />
        <AdminControls view={view} notice={notice} csrf={user.csrf} />
        <PlannedHike view={view} />
        <LogPreview view={view} />
        <CalendarAddress view={view} />
      </div>
    </Layout>
  );
}
