/**
 * The page for a signed-in user whose session lists a server that Discord
 * says they are no longer a member of. It shows nothing of the server, not
 * even its name, and offers Refresh servers, which signs in again to read
 * the user's servers afresh.
 */
import type { LayoutUser } from "../../layout";
import { MessagePage } from "../message";

/** Signs in again and comes back to the fresh list of servers. */
export const REFRESH_SERVERS_PATH = "/login?next=/servers";

export function NotMemberPage({ user }: { user: LayoutUser }) {
  return (
    <MessagePage
      title="You are not a member of this server any more"
      lead="Discord says you are no longer in this server, so hikebot cannot show you its hikes. If you have joined it again, or joined another, refresh your servers."
      action={{ href: REFRESH_SERVERS_PATH, label: "Refresh servers" }}
      secondary={{ href: "/servers", label: "Choose a server" }}
      user={user}
    />
  );
}
