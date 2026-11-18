import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
  type RESTPutAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";

/**
 * The bot's global slash commands, as `npm run register` sends them to
 * Discord's bulk overwrite. Commands are guild-only and carry no
 * `default_member_permissions`: everyone sees them and the bot enforces who
 * may use them.
 */
export const commands = [
  {
    type: ApplicationCommandType.ChatInput,
    name: "hike",
    description: "Plan the group's hikes",
    contexts: [InteractionContextType.Guild],
    integration_types: [ApplicationIntegrationType.GuildInstall],
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "admin",
        description: "Open the hikebot admin panel",
      },
    ],
  },
] satisfies RESTPutAPIApplicationCommandsJSONBody;
