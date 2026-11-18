/**
 * Builds Discord interaction payloads, signs them with the harness's key
 * pair, and sends them to the Worker over HTTP the way Discord does. Every
 * answer must arrive within Discord's 3-second window and be a valid
 * response for the interaction type, or the send fails the test.
 */
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ChannelType,
  ComponentType,
  InteractionContextType,
  InteractionType,
  type APIApplicationCommandInteractionDataOption,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { generateKeyPairSync, sign } from "node:crypto";
import { snowflake, type FakeDiscord } from "./fake-discord";
import { describeViolations, validateInteractionResponse } from "./validate";

/** Discord drops an interaction the bot has not answered in 3 seconds. */
export const RESPONSE_DEADLINE_MS = 3_000;

export interface Signer {
  publicKeyHex: string;
  /** Hex signature of `timestamp + body`, as Discord signs requests. */
  sign(timestamp: string, body: string): string;
}

/** A fresh Ed25519 key pair; its public key becomes DISCORD_PUBLIC_KEY. */
export function createSigner(): Signer {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const { x } = publicKey.export({ format: "jwk" });
  return {
    publicKeyHex: Buffer.from(x ?? "", "base64url").toString("hex"),
    sign(timestamp, body) {
      return sign(null, Buffer.from(timestamp + body), privateKey).toString(
        "hex",
      );
    },
  };
}

/** Who sends an interaction, and from where. */
export interface Actor {
  /** Leave out for an interaction from a DM. */
  guildId?: string;
  channelId: string;
  userId: string;
  roles?: string[];
  /** The member's permissions in the channel, as a bit set string. */
  permissions?: string;
}

/**
 * A plain object the client signs and sends: the fields every interaction
 * has, plus whatever its type carries.
 */
export type Interaction = {
  id: string;
  application_id: string;
  type: InteractionType;
  token: string;
} & Record<string, unknown>;

function base(
  actor: Actor,
  type: InteractionType,
  applicationId: string,
): Interaction {
  const user = {
    id: actor.userId,
    username: `user${actor.userId}`,
    discriminator: "0",
    global_name: `User ${actor.userId}`,
    avatar: null,
  };
  const common = {
    id: snowflake(),
    application_id: applicationId,
    type,
    token: `interaction-token-${snowflake()}`,
    version: 1,
    channel_id: actor.channelId,
    locale: "en-US",
    app_permissions: "2248473465835073",
    entitlements: [],
    attachment_size_limit: 10_485_760,
  };
  if (actor.guildId === undefined) {
    return {
      ...common,
      channel: { id: actor.channelId, type: ChannelType.DM },
      user,
      authorizing_integration_owners: { "1": actor.userId },
      context: InteractionContextType.BotDM,
    };
  }
  return {
    ...common,
    guild_id: actor.guildId,
    guild: { id: actor.guildId, locale: "en-US", features: [] },
    guild_locale: "en-US",
    channel: {
      id: actor.channelId,
      type: ChannelType.GuildText,
      guild_id: actor.guildId,
    },
    member: {
      user,
      roles: actor.roles ?? [],
      permissions: actor.permissions ?? "2248473465835073",
      joined_at: "2026-01-01T00:00:00.000000+00:00",
      nick: null,
      avatar: null,
      premium_since: null,
      deaf: false,
      mute: false,
      pending: false,
      flags: 0,
    },
    authorizing_integration_owners: { "0": actor.guildId },
    context: InteractionContextType.Guild,
  };
}

/** A message as a component interaction carries it. */
export interface SourceMessage {
  id: string;
  channel_id: string;
  flags: number;
  components: unknown[];
}

export class InteractionClient {
  private readonly url: URL;
  private readonly signer: Signer;
  readonly discord: FakeDiscord;
  readonly applicationId: string;

  constructor(options: {
    url: URL;
    signer: Signer;
    discord: FakeDiscord;
    applicationId: string;
  }) {
    this.url = options.url;
    this.signer = options.signer;
    this.discord = options.discord;
    this.applicationId = options.applicationId;
  }

  ping(): Interaction {
    return {
      id: snowflake(),
      application_id: this.applicationId,
      type: InteractionType.Ping,
      token: `interaction-token-${snowflake()}`,
      version: 1,
    };
  }

  /** A slash command, with options as Discord sends them. */
  command(
    actor: Actor,
    name: string,
    options: APIApplicationCommandInteractionDataOption[] = [],
  ): Interaction {
    return {
      ...base(actor, InteractionType.ApplicationCommand, this.applicationId),
      data: {
        id: snowflake(),
        name,
        type: ApplicationCommandType.ChatInput,
        ...(options.length > 0 ? { options } : {}),
      },
    };
  }

  /** A button click on `message`. */
  button(actor: Actor, customId: string, message: SourceMessage): Interaction {
    return this.component(actor, message, {
      custom_id: customId,
      component_type: ComponentType.Button,
    });
  }

  /** A string select choice on `message`. */
  stringSelect(
    actor: Actor,
    customId: string,
    values: string[],
    message: SourceMessage,
  ): Interaction {
    return this.component(actor, message, {
      custom_id: customId,
      component_type: ComponentType.StringSelect,
      values,
    });
  }

  /** A role select choice on `message`, with the roles resolved. */
  roleSelect(
    actor: Actor,
    customId: string,
    roleIds: string[],
    message: SourceMessage,
  ): Interaction {
    return this.component(actor, message, {
      custom_id: customId,
      component_type: ComponentType.RoleSelect,
      values: roleIds,
      resolved: {
        roles: Object.fromEntries(
          roleIds.map((id) => [
            id,
            {
              id,
              name: `role-${id}`,
              color: 0,
              hoist: false,
              position: 1,
              permissions: "0",
              managed: false,
              mentionable: true,
              flags: 0,
            },
          ]),
        ),
      },
    });
  }

  /** A channel select choice on `message`, with the channels resolved. */
  channelSelect(
    actor: Actor,
    customId: string,
    channels: { id: string; type: ChannelType }[],
    message: SourceMessage,
  ): Interaction {
    return this.component(actor, message, {
      custom_id: customId,
      component_type: ComponentType.ChannelSelect,
      values: channels.map((c) => c.id),
      resolved: {
        channels: Object.fromEntries(
          channels.map((c) => [
            c.id,
            {
              id: c.id,
              type: c.type,
              name: `channel-${c.id}`,
              permissions: "2248473465835073",
            },
          ]),
        ),
      },
    });
  }

  /**
   * A modal submit. `fields` maps each field's custom_id to its value; each
   * arrives wrapped in a Label, as Discord sends fields of a Label modal. A
   * string value is a text input, an array the values of a select.
   */
  modalSubmit(
    actor: Actor,
    customId: string,
    fields: Record<string, string | string[]>,
    message?: SourceMessage,
  ): Interaction {
    const components = Object.entries(fields).map(([fieldId, value], i) => ({
      type: ComponentType.Label,
      id: i * 2 + 1,
      component:
        typeof value === "string"
          ? {
              type: ComponentType.TextInput,
              id: i * 2 + 2,
              custom_id: fieldId,
              value,
            }
          : {
              type: ComponentType.StringSelect,
              id: i * 2 + 2,
              custom_id: fieldId,
              values: value,
            },
    }));
    return {
      ...base(actor, InteractionType.ModalSubmit, this.applicationId),
      data: { custom_id: customId, components },
      ...(message
        ? { message: messageObject(message, this.applicationId) }
        : {}),
    };
  }

  private component(
    actor: Actor,
    message: SourceMessage,
    data: Record<string, unknown>,
  ): Interaction {
    return {
      ...base(actor, InteractionType.MessageComponent, this.applicationId),
      data,
      message: messageObject(message, this.applicationId),
    };
  }

  /** Signature headers for `body`, signed now. */
  signatureHeaders(body: string): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      "X-Signature-Ed25519": this.signer.sign(timestamp, body),
      "X-Signature-Timestamp": timestamp,
    };
  }

  /** POSTs a raw body to /interactions with the given headers. */
  post(body: string, headers: Record<string, string>): Promise<Response> {
    return fetch(new URL("/interactions", this.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Discord-Interactions/1.0 (+https://discord.com)",
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(RESPONSE_DEADLINE_MS),
    });
  }

  /**
   * Signs and sends `interaction`, records the answer in the fake Discord
   * API as Discord would show it, and returns it. Fails if the Worker takes
   * over 3 seconds, answers with anything but 200 and JSON, or answers with
   * a response Discord would refuse for this interaction type.
   */
  async send(interaction: Interaction): Promise<APIInteractionResponse> {
    const body = JSON.stringify(interaction);
    const started = performance.now();
    let response: Response;
    let text: string;
    try {
      response = await this.post(body, this.signatureHeaders(body));
      text = await response.text();
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error(
          `the Worker did not answer interaction type ${String(interaction.type)} within ${String(RESPONSE_DEADLINE_MS)} ms; Discord would show "This interaction failed"`,
          { cause: error },
        );
      }
      throw error;
    }
    const elapsed = performance.now() - started;
    if (elapsed > RESPONSE_DEADLINE_MS) {
      throw new Error(
        `the Worker took ${elapsed.toFixed(0)} ms to answer; Discord allows ${String(RESPONSE_DEADLINE_MS)} ms`,
      );
    }
    if (response.status !== 200) {
      throw new Error(
        `the Worker answered the interaction with HTTP ${String(response.status)}: ${text}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `the Worker answered with a body that is not JSON: ${text}`,
        {
          cause: error,
        },
      );
    }
    const message = interaction.message as SourceMessage | undefined;
    const violations = validateInteractionResponse(
      { type: interaction.type, message },
      parsed,
    );
    if (violations.length > 0) {
      throw new Error(
        `Discord would refuse the Worker's interaction response: ${describeViolations(violations)}\n${text}`,
      );
    }
    const answer = parsed as APIInteractionResponse;
    if (interaction.type !== InteractionType.Ping) {
      this.discord.recordInteractionResponse(
        {
          token: interaction.token,
          guild_id: interaction.guild_id as string | undefined,
          channel_id: interaction.channel_id as string | undefined,
          message,
        },
        answer,
      );
    }
    return answer;
  }
}

function messageObject(
  message: SourceMessage,
  applicationId: string,
): Record<string, unknown> {
  return {
    id: message.id,
    channel_id: message.channel_id,
    type: 0,
    author: { id: applicationId, username: "hikebot", bot: true },
    content: "",
    embeds: [],
    components: message.components,
    flags: message.flags,
    timestamp: "2026-01-01T00:00:00.000000+00:00",
    edited_timestamp: null,
    attachments: [],
    mentions: [],
    mention_roles: [],
    pinned: false,
    tts: false,
    mention_everyone: false,
  };
}

/** A string option, as in `/hike start location:Ridge`. */
export function stringOption(
  name: string,
  value: string,
): APIApplicationCommandInteractionDataOption {
  return { type: ApplicationCommandOptionType.String, name, value };
}

/** A subcommand with its options, as in `/hike start ...`. */
export function subcommand(
  name: string,
  options: APIApplicationCommandInteractionDataOption[] = [],
): APIApplicationCommandInteractionDataOption {
  return {
    type: ApplicationCommandOptionType.Subcommand,
    name,
    options,
  } as APIApplicationCommandInteractionDataOption;
}
