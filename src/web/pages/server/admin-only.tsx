/**
 * The 403 page for a member who is not an admin and opened an admin's
 * page or posted an admin's action: the panel's own refusal, and the way
 * back to the server's page.
 */
import { ADMIN_ONLY_MESSAGE } from "../../../guild/permissions";
import { ArrowLeftIcon } from "../../components/icons";
import type { LayoutUser } from "../../layout";
import { MessagePage } from "../message";

export function AdminOnlyPage({
  user,
  guildId,
}: {
  user: LayoutUser;
  guildId: string;
}) {
  return (
    <MessagePage
      title="Only admins can do this"
      lead={`${ADMIN_ONLY_MESSAGE} Nothing was changed.`}
      action={{
        href: `/g/${guildId}`,
        label: "Back to the server",
        icon: ArrowLeftIcon,
      }}
      user={user}
    />
  );
}
