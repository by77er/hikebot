/**
 * The page for a server's page or action when Discord could not be asked
 * whether the user is a member: a calm try-again, with nothing of the
 * server and no detail of what Discord answered.
 */
import type { LayoutUser } from "../../layout";
import { MessagePage } from "../message";

export function DiscordUnavailablePage({
  user,
  retry,
}: {
  user: LayoutUser;
  /** The page to load again, such as `/g/<guild id>`. */
  retry: string;
}) {
  return (
    <MessagePage
      title="Discord could not be reached"
      lead="hikebot checks with Discord that you are in this server before showing it, and Discord did not answer just now. Wait a moment and try again."
      action={{ href: retry, label: "Try again" }}
      secondary={{ href: "/servers", label: "Choose a server" }}
      user={user}
    />
  );
}
