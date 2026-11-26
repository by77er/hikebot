/**
 * A notice of the settings (what a save did, or why it was refused) as a
 * page shows it: the bot's words, with a role or channel the panel would
 * mention named as Discord names it (`@Hike leads`, `#hikes`), and its bold
 * and code as `strong` and `code`. Text stays text.
 */
import type { Notice } from "../../../../features/settings";
import type { WebSettingsForm } from "../../../../features/settings-form";

/** A channel's name from the form's choices, or "deleted channel". */
export function channelName(form: WebSettingsForm, id: string): string {
  for (const choices of Object.values(form.channels)) {
    const found = choices.find((channel) => channel.id === id);
    if (found !== undefined) return found.name;
  }
  return DELETED_CHANNEL;
}

/** A role's name from the form's choices, or "deleted role". */
export function roleName(form: WebSettingsForm, id: string): string {
  return form.roles.find((role) => role.id === id)?.name ?? DELETED_ROLE;
}

/** What a channel that no longer exists in Discord is called. */
export const DELETED_CHANNEL = "deleted channel";
/** What a role that no longer exists in Discord is called. */
export const DELETED_ROLE = "deleted role";

/** `#hikes`, `@Hike leads`; a deleted one by those words alone. */
function mention(prefix: string, name: string): string {
  return name === DELETED_CHANNEL || name === DELETED_ROLE
    ? name
    : `${prefix}${name}`;
}

export function NoticeText({
  notice,
  form,
}: {
  notice: Notice;
  form: WebSettingsForm;
}) {
  return (
    <>
      {notice.map((part) => {
        if (typeof part === "string") return part;
        if ("role" in part) return mention("@", roleName(form, part.role));
        if ("channel" in part) {
          return mention("#", channelName(form, part.channel));
        }
        if ("strong" in part) return <strong>{part.strong}</strong>;
        return <code>{part.code}</code>;
      })}
    </>
  );
}
