/**
 * A server's hike log at `/g/<guild id>/log?page=<n>`: every hike, newest
 * first, `HIKES_PER_PAGE` a page, with Newer and Older as the bot's log
 * has them, and the way back to the server's page.
 */
import { NO_HIKES_MESSAGE } from "../../../features/hike-log";
import type { WebView } from "../../../guild/web-view";
import { BackLink } from "../../components/back-link";
import { EmptyState } from "../../components/empty-state";
import { Pagination } from "../../components/pagination";
import { Layout, type LayoutUser } from "../../layout";
import { HikeEntry, hikeCount, logPath } from "./hike-entry";

export function HikeLogPage({
  user,
  view,
}: {
  user: LayoutUser;
  view: WebView;
}) {
  const { log, server } = view;
  const position = `Page ${String(log.page)} of ${String(log.pages)}`;
  return (
    <Layout title={`Hike log · ${server.name} · hikebot`} user={user}>
      <div class="stack stack--section">
        <div class="stack">
          <BackLink href={`/g/${server.id}`}>Back to {server.name}</BackLink>
          <div class="page-heading">
            <h1>Hike log</h1>
            <p class="page-heading__lead">
              {log.pages > 1
                ? `${hikeCount(log.total)} · page ${String(log.page)} of ${String(log.pages)}`
                : hikeCount(log.total)}
            </p>
          </div>
        </div>
        {log.entries.length === 0 ? (
          <EmptyState title="No hikes yet">{NO_HIKES_MESSAGE}</EmptyState>
        ) : (
          <ol class="stack list-reset" aria-label="Hikes">
            {log.entries.map((entry) => (
              <li key={entry.roundId}>
                <HikeEntry view={view} entry={entry} headingLevel={2} />
              </li>
            ))}
          </ol>
        )}
        {log.pages > 1 && (
          <Pagination
            label="Hike log pages"
            position={position}
            newer={log.page > 1 ? logPath(server.id, log.page - 1) : undefined}
            older={
              log.page < log.pages
                ? logPath(server.id, log.page + 1)
                : undefined
            }
          />
        )}
      </div>
    </Layout>
  );
}
