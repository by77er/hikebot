/**
 * The real Worker plus one extra slash command, `/e2e-probe`, for harness
 * self-tests that need the bot to keep state or call Discord before any
 * feature does. Only `useE2E({ probe: true })` runs this entry point; feature
 * scenarios run the real bundle from wrangler.jsonc.
 *
 *   /e2e-probe remember note:<text>  stores a note in the guild's object
 *   /e2e-probe recall                 lists the guild's notes
 *   /e2e-probe post channel:<id>      defers, posts a message to the channel
 *                                     through DiscordApi, then edits the
 *                                     deferred reply with the outcome
 */
import {
  ApplicationCommandOptionType,
  type APIApplicationCommandInteractionDataOption,
  type APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import { discordApi, DiscordApiError } from "../../../src/discord/api";
import {
  container,
  deferredReply,
  ephemeralReply,
  messageBody,
  textDisplay,
} from "../../../src/discord/components";
import { GuildHike as RealGuildHike } from "../../../src/guild/guild-hike";
import type { CommandHandler } from "../../../src/guild/router";
import worker from "../../../src/index";

export default worker;

const NOTES_KEY = "e2e-probe:notes";

export class GuildHike extends RealGuildHike {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.router.command("e2e-probe", probe);
  }
}

const probe: CommandHandler = async (interaction, { env, storage }) => {
  const [sub] = (interaction as APIChatInputApplicationCommandInteraction).data
    .options ?? [];
  const options =
    sub?.type === ApplicationCommandOptionType.Subcommand
      ? (sub.options ?? [])
      : [];
  switch (sub?.name) {
    case "remember": {
      const notes = (await storage.get<string[]>(NOTES_KEY)) ?? [];
      notes.push(stringOption(options, "note"));
      await storage.put(NOTES_KEY, notes);
      return { response: ephemeralReply([textDisplay(`Remembered ${String(notes.length)}`)]) };
    }
    case "recall": {
      const notes = (await storage.get<string[]>(NOTES_KEY)) ?? [];
      return {
        response: ephemeralReply([
          textDisplay(`Notes: ${notes.join(", ") || "none"}`),
        ]),
      };
    }
    case "post": {
      const channelId = stringOption(options, "channel");
      return {
        response: deferredReply({ ephemeral: true }),
        followUp: async () => {
          const api = discordApi(env);
          let outcome: string;
          try {
            const message = await api.createMessage(
              channelId,
              messageBody([container([textDisplay("Probe post")])]),
            );
            outcome = `Posted ${message.id}`;
          } catch (error) {
            if (!(error instanceof DiscordApiError)) throw error;
            outcome = `Discord refused: ${String(error.status)} ${String(error.code)}`;
          }
          await api.editOriginalInteractionResponse(
            interaction.application_id,
            interaction.token,
            messageBody([textDisplay(outcome)]),
          );
        },
      };
    }
    default:
      return { response: ephemeralReply([textDisplay("Unknown probe")]) };
  }
};

function stringOption(
  options: APIApplicationCommandInteractionDataOption[],
  name: string,
): string {
  const option = options.find((o) => o.name === name);
  return option?.type === ApplicationCommandOptionType.String
    ? option.value
    : "";
}
