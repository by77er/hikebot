/**
 * The list of the signed-in user's servers that hikebot is in, at
 * `/servers`, as of sign-in: a tile per server linking to its page, then
 * Refresh servers for a list that is out of date. With no servers, an
 * empty state says why, and how a server admin adds hikebot.
 */
import type { SessionGuild } from "../auth/session";
import { Button } from "../components/button";
import { EmptyState } from "../components/empty-state";
import { ExternalLinkIcon } from "../components/icons";
import { ServerTileList } from "../components/server-tile";
import { Layout, type LayoutUser } from "../layout";

const REFRESH_PATH = "/login?next=/servers";

export function ServersPage({
  user,
  guilds,
  inviteUrl,
}: {
  user: LayoutUser;
  guilds: SessionGuild[];
  /** The link that adds hikebot to a server (`inviteUrl` in invite.ts). */
  inviteUrl: string;
}) {
  return (
    <Layout title="Choose a server · hikebot" user={user} width="overview">
      <div class="stack stack--loose">
        <div class="page-heading">
          <h1>Choose a server</h1>
          {guilds.length > 0 && (
            <p class="page-heading__lead">
              The servers you share with hikebot.
            </p>
          )}
        </div>
        {guilds.length === 0 ? (
          <EmptyState
            title="hikebot is not in any of your servers"
            action={
              <Button href={inviteUrl} iconAfter={ExternalLinkIcon}>
                Add hikebot to a server
              </Button>
            }
          >
            A server admin can add it to their server; then refresh your servers
            to see it here.
          </EmptyState>
        ) : (
          <ServerTileList servers={guilds} />
        )}
        <div class="stack stack--tight">
          <p class="u-muted">
            This list is from when you signed in. Joined a server, or added
            hikebot to one since?
          </p>
          <div class="cluster">
            <Button variant="quiet" href={REFRESH_PATH}>
              Refresh servers
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
