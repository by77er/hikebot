import type {
  APIAllowedMentions,
  RESTError,
  RESTGetAPIGuildChannelsResult,
  RESTGetAPIGuildMemberResult,
  RESTGetAPIGuildResult,
  RESTPatchAPIChannelMessageJSONBody,
  RESTPatchAPIChannelMessageResult,
  RESTPatchAPIWebhookWithTokenMessageJSONBody,
  RESTPatchAPIWebhookWithTokenMessageResult,
  RESTPostAPIChannelMessageJSONBody,
  RESTPostAPIChannelMessageResult,
  RESTPostAPIChannelThreadsResult,
  RESTPostAPIGuildForumThreadsJSONBody,
  RESTPostAPIGuildScheduledEventJSONBody,
  RESTPostAPIGuildScheduledEventResult,
  RESTPostAPIWebhookWithTokenJSONBody,
  RESTPostAPIWebhookWithTokenWaitResult,
  RESTPutAPIApplicationCommandsJSONBody,
  RESTPutAPIApplicationCommandsResult,
} from "discord-api-types/v10";

export const DEFAULT_DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * The link to a guild's scheduled event, which members open to see it and
 * click Interested. A link, not an API route.
 */
export function eventUrl(guildId: string, eventId: string): string {
  return `https://discord.com/events/${guildId}/${eventId}`;
}

const USER_AGENT = "DiscordBot (https://github.com/by77er/hikebot, 0.0.0)";

/** Mentions in bot messages never notify anyone unless a caller says so. */
const NO_MENTIONS: APIAllowedMentions = { parse: [] };

export interface DiscordApiOptions {
  /** Bot token, sent as `Authorization: Bot <token>` on bot routes. */
  token: string;
  /** Defaults to {@link DEFAULT_DISCORD_API_BASE}. */
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries after a 429 before giving up. */
  maxRetries?: number;
  /** Total time spent waiting on 429s before giving up, in ms. */
  maxRetryWaitMs?: number;
}

/**
 * A failed Discord REST call. `code` and `discordMessage` come from Discord's
 * JSON error body when there is one; `route` never contains an interaction
 * token.
 */
export class DiscordApiError extends Error {
  override readonly name = "DiscordApiError";

  constructor(
    readonly method: string,
    readonly route: string,
    readonly status: number,
    readonly code: number | undefined,
    readonly discordMessage: string,
    readonly errors?: unknown,
  ) {
    super(
      `${method} ${route} failed with ${String(status)}: ${discordMessage}` +
        (code === undefined ? "" : ` (code ${String(code)})`),
    );
  }
}

interface Call {
  method: "GET" | "POST" | "PATCH" | "PUT";
  /** Path appended to the base URL. */
  path: string;
  /** Path as reported in errors; defaults to `path`. */
  route?: string;
  body?: unknown;
  /** Send the bot token. False for interaction webhook routes. */
  auth: boolean;
}

/** Builds a client from the Worker's environment. */
export function discordApi(
  env: { DISCORD_BOT_TOKEN: string; DISCORD_API_BASE?: string },
  options: Omit<DiscordApiOptions, "token"> = {},
): DiscordApi {
  return new DiscordApi({
    token: env.DISCORD_BOT_TOKEN,
    baseUrl: env.DISCORD_API_BASE || undefined,
    ...options,
  });
}

export class DiscordApi {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly maxRetryWaitMs: number;

  constructor(options: DiscordApiOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_DISCORD_API_BASE).replace(
      /\/+$/,
      "",
    );
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetries = options.maxRetries ?? 3;
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? 5_000;
  }

  createMessage(
    channelId: string,
    body: RESTPostAPIChannelMessageJSONBody,
  ): Promise<RESTPostAPIChannelMessageResult> {
    return this.call({
      method: "POST",
      path: `/channels/${channelId}/messages`,
      body: withoutPings(body),
      auth: true,
    });
  }

  editMessage(
    channelId: string,
    messageId: string,
    body: RESTPatchAPIChannelMessageJSONBody,
  ): Promise<RESTPatchAPIChannelMessageResult> {
    return this.call({
      method: "PATCH",
      path: `/channels/${channelId}/messages/${messageId}`,
      body: withoutPings(body),
      auth: true,
    });
  }

  /** Creates a thread with its first message in a forum channel. */
  startForumThread(
    forumChannelId: string,
    body: RESTPostAPIGuildForumThreadsJSONBody,
  ): Promise<RESTPostAPIChannelThreadsResult> {
    return this.call({
      method: "POST",
      path: `/channels/${forumChannelId}/threads`,
      body: { ...body, message: withoutPings(body.message) },
      auth: true,
    });
  }

  /** Creates a scheduled event; the bot needs Create Events in the guild. */
  createGuildScheduledEvent(
    guildId: string,
    body: RESTPostAPIGuildScheduledEventJSONBody,
  ): Promise<RESTPostAPIGuildScheduledEventResult> {
    return this.call({
      method: "POST",
      path: `/guilds/${guildId}/scheduled-events`,
      body,
      auth: true,
    });
  }

  getGuild(guildId: string): Promise<RESTGetAPIGuildResult> {
    return this.call({
      method: "GET",
      path: `/guilds/${guildId}`,
      auth: true,
    });
  }

  /**
   * The guild's member `userId`, with their role ids. Discord answers 404
   * (code 10007, Unknown Member) when the user is not a member.
   */
  getGuildMember(
    guildId: string,
    userId: string,
  ): Promise<RESTGetAPIGuildMemberResult> {
    return this.call({
      method: "GET",
      path: `/guilds/${guildId}/members/${userId}`,
      auth: true,
    });
  }

  /** The guild's channels, without threads. */
  getGuildChannels(guildId: string): Promise<RESTGetAPIGuildChannelsResult> {
    return this.call({
      method: "GET",
      path: `/guilds/${guildId}/channels`,
      auth: true,
    });
  }

  editOriginalInteractionResponse(
    applicationId: string,
    token: string,
    body: RESTPatchAPIWebhookWithTokenMessageJSONBody,
  ): Promise<RESTPatchAPIWebhookWithTokenMessageResult> {
    return this.call({
      method: "PATCH",
      path: `/webhooks/${applicationId}/${token}/messages/@original`,
      route: `/webhooks/${applicationId}/:token/messages/@original`,
      body: withoutPings(body),
      auth: false,
    });
  }

  createFollowup(
    applicationId: string,
    token: string,
    body: RESTPostAPIWebhookWithTokenJSONBody,
  ): Promise<RESTPostAPIWebhookWithTokenWaitResult> {
    return this.call({
      method: "POST",
      path: `/webhooks/${applicationId}/${token}?wait=true`,
      route: `/webhooks/${applicationId}/:token`,
      body: withoutPings(body),
      auth: false,
    });
  }

  bulkOverwriteGlobalCommands(
    applicationId: string,
    commands: RESTPutAPIApplicationCommandsJSONBody,
  ): Promise<RESTPutAPIApplicationCommandsResult> {
    return this.call({
      method: "PUT",
      path: `/applications/${applicationId}/commands`,
      body: commands,
      auth: true,
    });
  }

  private async call<T>(call: Call): Promise<T> {
    const route = call.route ?? call.path;
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (call.auth) headers.Authorization = `Bot ${this.token}`;
    if (call.body !== undefined) headers["Content-Type"] = "application/json";
    const init: RequestInit = {
      method: call.method,
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
    };

    let retries = 0;
    let waitedMs = 0;
    for (;;) {
      const response = await this.fetch(`${this.baseUrl}${call.path}`, init);
      if (response.ok) {
        return (
          response.status === 204 ? undefined : await response.json()
        ) as T;
      }
      const error = await readError(response);
      if (response.status === 429) {
        const waitMs = retryAfterMs(response, error.body);
        if (
          retries < this.maxRetries &&
          waitMs !== undefined &&
          waitedMs + waitMs <= this.maxRetryWaitMs
        ) {
          retries += 1;
          waitedMs += waitMs;
          await this.sleep(waitMs);
          continue;
        }
      }
      throw new DiscordApiError(
        call.method,
        route,
        response.status,
        error.code,
        error.message,
        error.errors,
      );
    }
  }
}

function withoutPings<B extends { allowed_mentions?: unknown }>(body: B): B {
  return body.allowed_mentions === undefined
    ? { ...body, allowed_mentions: NO_MENTIONS }
    : body;
}

interface ReadError {
  code: number | undefined;
  message: string;
  errors?: unknown;
  body: unknown;
}

async function readError(response: Response): Promise<ReadError> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (isRestError(body)) {
    return {
      code: body.code,
      message: body.message,
      errors: body.errors,
      body,
    };
  }
  const message =
    typeof (body as { message?: unknown } | undefined)?.message === "string"
      ? (body as { message: string }).message
      : text.trim().slice(0, 200) || response.statusText || "no body";
  return { code: undefined, message, body };
}

function isRestError(body: unknown): body is RESTError {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as RESTError).code === "number" &&
    typeof (body as RESTError).message === "string"
  );
}

/** Milliseconds Discord asks us to wait, from the body or Retry-After. */
function retryAfterMs(response: Response, body: unknown): number | undefined {
  const fromBody = (body as { retry_after?: unknown } | undefined)?.retry_after;
  const seconds =
    typeof fromBody === "number"
      ? fromBody
      : Number.parseFloat(response.headers.get("Retry-After") ?? "");
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.ceil(seconds * 1000)
    : undefined;
}
