/**
 * The list of the signed-in user's servers that hikebot is in, at
 * `/servers`, as of sign-in. Each links to the server's page.
 */
import type { SessionGuild } from "../auth/session";
import { Layout, type LayoutUser } from "../layout";

export function ServersPage({
  user,
  guilds,
}: {
  user: LayoutUser;
  guilds: SessionGuild[];
}) {
  return (
    <Layout title="Your servers · hikebot" user={user}>
      <h1>Your servers</h1>
      {guilds.length === 0 ? (
        <p>
          hikebot is not in any of your servers. A server admin can add it to
          their server.
        </p>
      ) : (
        <ul>
          {guilds.map((guild) => (
            <li key={guild.id}>
              <a href={`/g/${guild.id}`}>{guild.name}</a>
            </li>
          ))}
        </ul>
      )}
      <p>
        <a href="/login?next=/servers">Refresh servers</a>
      </p>
    </Layout>
  );
}
