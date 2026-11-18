/**
 * The list of the signed-in user's servers that hikebot is in, at
 * `/servers`, as of sign-in. Each is a card linking to the server's page.
 */
import type { SessionGuild } from "../auth/session";
import { Button } from "../components/button";
import { Card } from "../components/card";
import { Layout, type LayoutUser } from "../layout";

export function ServersPage({
  user,
  guilds,
}: {
  user: LayoutUser;
  guilds: SessionGuild[];
}) {
  return (
    <Layout title="Your servers · hikebot" user={user} width="overview">
      <div class="stack stack--loose">
        <div class="page-heading">
          <h1>Your servers</h1>
          <p class="page-heading__lead">
            The servers you share with hikebot, as of when you signed in.
          </p>
        </div>
        {guilds.length === 0 ? (
          <p>
            hikebot is not in any of your servers. A server admin can add it to
            their server.
          </p>
        ) : (
          <ul class="grid list-reset">
            {guilds.map((guild) => (
              <li key={guild.id}>
                <Card title={guild.name} href={`/g/${guild.id}`} />
              </li>
            ))}
          </ul>
        )}
        <div class="cluster">
          <Button href="/login?next=/servers">Refresh servers</Button>
        </div>
      </div>
    </Layout>
  );
}
