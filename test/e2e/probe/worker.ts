/**
 * The real Worker plus one extra slash command, `/e2e-probe`, for harness
 * self-tests that need the bot to keep state or call Discord before any
 * feature does. Only `useE2E({ probe: true })` runs this entry point; feature
 * scenarios run the real bundle from wrangler.jsonc. The default export is
 * the real Worker and `GuildHike` the real object with one more command on
 * its router, so requests take the real signature check, guild routing and
 * follow-up path, and Discord calls go through the real `DiscordApi`.
 *
 *   /e2e-probe remember note:<text>  stores a note in the guild's object
 *   /e2e-probe recall                 lists the guild's notes
 *   /e2e-probe post channel:<id>      defers, posts a message to the channel,
 *                                     then edits the deferred reply with the
 *                                     outcome
 *   /e2e-probe owner                  defers, reads the guild, then edits the
 *                                     deferred reply with its owner
 */
import {
  ApplicationCommandOptionType,
  type APIApplicationCommandInteractionDataOption,
  type APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import {
  discordApi,
  DiscordApiError,
  type DiscordApi,
} from "../../../src/discord/api";
import {
  container,
  deferredReply,
  ephemeralReply,
  messageBody,
  textDisplay,
} from "../../../src/discord/components";
import { GuildHike as RealGuildHike } from "../../../src/guild/guild-hike";
import type { CommandHandler, HandlerResult } from "../../../src/guild/router";
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
  const [sub] =
    (interaction as APIChatInputApplicationCommandInteraction).data.options ??
    [];
  const options =
    sub?.type === ApplicationCommandOptionType.Subcommand
      ? (sub.options ?? [])
      : [];
  // Defers, makes one REST call, and edits the deferred reply with its
  // outcome or with the DiscordApiError it threw.
  const deferThen = (
    call: (api: DiscordApi) => Promise<string>,
  ): HandlerResult => ({
    response: deferredReply({ ephemeral: true }),
    followUp: async () => {
      const api = discordApi(env);
      let outcome: string;
      try {
        outcome = await call(api);
      } catch (error) {
        if (!(error instanceof DiscordApiError)) throw error;
        outcome = `Discord refused: ${String(error.status)} ${String(error.code)} on ${error.method} ${error.route}`;
      }
      await api.editOriginalInteractionResponse(
        interaction.application_id,
        interaction.token,
        messageBody([textDisplay(outcome)]),
      );
    },
  });
  switch (sub?.name) {
    case "remember": {
      const notes = (await storage.get<string[]>(NOTES_KEY)) ?? [];
      notes.push(stringOption(options, "note"));
      await storage.put(NOTES_KEY, notes);
      return {
        response: ephemeralReply([
          textDisplay(`Remembered ${String(notes.length)}`),
        ]),
      };
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
      return deferThen(async (api) => {
        const message = await api.createMessage(
          channelId,
          messageBody([container([textDisplay("Probe post")])]),
        );
        return `Posted ${message.id}`;
      });
    }
    case "owner":
      return deferThen(async (api) => {
        const guild = await api.getGuild(interaction.guild_id ?? "");
        return `Owner ${guild.owner_id}`;
      });
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
