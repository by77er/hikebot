import {
  ComponentType,
  InteractionResponseType,
  MessageFlags,
  type APIInteractionResponseChannelMessageWithSource,
} from "discord-api-types/v10";

export const GUILD_ONLY_MESSAGE =
  "hikebot only works in servers. Use it from a server it has been added to.";

/** An ephemeral Components V2 reply holding a single line of text. */
export function ephemeralNotice(
  text: string,
): APIInteractionResponseChannelMessageWithSource {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      components: [{ type: ComponentType.TextDisplay, content: text }],
      allowed_mentions: { parse: [] },
    },
  };
}
