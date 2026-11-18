import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
} from "discord-api-types/v10";
import { ephemeralNotice } from "../discord/responses";
import { UNAVAILABLE_MESSAGE, type CommandHandler } from "../guild/router";
import { openAdminPanel } from "./admin-panel";
import { showHikeLog } from "./hike-log";

/**
 * The handlers of `/hike`'s subcommands, by name. Each subcommand here is
 * also defined in `src/discord/commands.ts`.
 */
const subcommands: Record<string, CommandHandler | undefined> = {
  admin: openAdminPanel,
  log: showHikeLog,
};

/**
 * `/hike <subcommand>`: hands the interaction to the subcommand's handler.
 * A subcommand without a handler, or none at all, gets the unavailable notice.
 */
export const hikeCommand: CommandHandler = (interaction, context) => {
  const option =
    interaction.data.type === ApplicationCommandType.ChatInput
      ? interaction.data.options?.[0]
      : undefined;
  const handler =
    option?.type === ApplicationCommandOptionType.Subcommand
      ? subcommands[option.name]
      : undefined;
  if (!handler) return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
  return handler(interaction, context);
};
