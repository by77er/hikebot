import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
} from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import { commands } from "../../src/discord/commands";

describe("commands", () => {
  it("define the guild-only /hike command with its admin subcommand", () => {
    expect(commands).toEqual([
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
    ]);
  });

  it("leave every command visible to all members, so the bot enforces access", () => {
    for (const command of commands) {
      expect(command).not.toHaveProperty("default_member_permissions");
    }
  });

  it("use names and descriptions Discord accepts", () => {
    // https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-naming
    const named = commands.flatMap((command) => [command, ...command.options]);
    for (const { name, description } of named) {
      expect(name).toMatch(/^[-_\p{Ll}\p{N}]{1,32}$/u);
      expect(description.length).toBeGreaterThanOrEqual(1);
      expect(description.length).toBeLessThanOrEqual(100);
    }
  });
});
