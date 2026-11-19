/**
 * A server's page at `/g/<guild id>`: what a member sees after choosing the
 * server. It only composes the page's sections, in a fixed order, one line
 * each; each section is a component in its own file in this directory that
 * takes the view and decides for itself whether it shows anything. "Add a
 * section to the server's page" in src/web/AGENTS.md says how to add one.
 */
import type { WebView } from "../../../guild/web-view";
import { Layout, type LayoutUser } from "../../layout";
import { CalendarAddress } from "./calendar-address";
import { CurrentStep } from "./current-step";
import { LogPreview } from "./log-preview";
import { PlannedHike } from "./planned-hike";
import { ServerHeading } from "./server-heading";

export function ServerPage({
  user,
  view,
}: {
  user: LayoutUser;
  view: WebView;
}) {
  return (
    <Layout title={`${view.server.name} · hikebot`} user={user}>
      <div class="stack stack--section">
        <ServerHeading view={view} />
        <CurrentStep view={view} />
        <PlannedHike view={view} />
        <LogPreview view={view} />
        <CalendarAddress view={view} />
      </div>
    </Layout>
  );
}
