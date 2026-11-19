import type {
  APIAllowedMentions,
  RESTAPIAttachment,
  RESTError,
  RESTGetAPICurrentUserGuildsQuery,
  RESTGetAPICurrentUserGuildsResult,
  RESTGetAPICurrentUserResult,
  RESTGetAPIGuildChannelsResult,
  RESTGetAPIGuildRolesResult,
  RESTGetAPIGuildMemberResult,
  RESTGetAPIGuildResult,
  RESTPatchAPIChannelJSONBody,
  RESTPatchAPIChannelMessageJSONBody,
  RESTPatchAPIChannelMessageResult,
  RESTPatchAPIChannelResult,
  RESTPatchAPIGuildScheduledEventJSONBody,
  RESTPatchAPIGuildScheduledEventResult,
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
  RESTPostOAuth2AccessTokenResult,
  RESTPutAPIApplicationCommandsJSONBody,
  RESTPutAPIApplicationCommandsResult,
} from "discord-api-types/v10";

export const DEFAULT_DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Where web sign-in sends the browser to authorize, when the
 * `DISCORD_OAUTH_AUTHORIZE_URL` var is empty. The token, revoke and user
 * routes go through the API base like every other call.
 */
export const DEFAULT_DISCORD_OAUTH_AUTHORIZE_URL =
  "https://discord.com/oauth2/authorize";

/** The query of Discord's authorize address, as web sign-in sends it. */
export interface OAuthAuthorizeQuery {
  clientId: string;
  scope: string;
  redirectUri: string;
  state: string;
}

/**
 * The address that asks Discord to authorize the application for the
 * signed-in Discord user (the authorization code grant), with
 * `prompt=none`, so a user who authorized before goes straight back.
 * https://discord.com/developers/docs/topics/oauth2#authorization-code-grant
 */
export function oauthAuthorizeUrl(
  env: { DISCORD_OAUTH_AUTHORIZE_URL?: string },
  query: OAuthAuthorizeQuery,
): string {
  const url = new URL(
    env.DISCORD_OAUTH_AUTHORIZE_URL || DEFAULT_DISCORD_OAUTH_AUTHORIZE_URL,
  );
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: query.clientId,
    scope: query.scope,
    redirect_uri: query.redirectUri,
    state: query.state,
    prompt: "none",
  }).toString();
  return url.href;
}

/** The application's OAuth2 client credentials. */
export interface OAuthClient {
  id: string;
  secret: string;
}

/**
 * The link to a guild's scheduled event, which members open to see it and
 * click Interested. A link, not an API route.
 */
export function eventUrl(guildId: string, eventId: string): string {
  return `https://discord.com/events/${guildId}/${eventId}`;
}

/**
 * The link to a channel or thread, or to a message in it when `messageId` is
 * given, which opens it in Discord. A link, not an API route.
 */
export function channelUrl(
  guildId: string,
  channelId: string,
  messageId?: string,
): string {
  const path = `${guildId}/${channelId}`;
  return `https://discord.com/channels/${messageId === undefined ? path : `${path}/${messageId}`}`;
}

/**
 * The guild's icon on Discord's image CDN, from the `icon` hash `getGuild`
 * returns. A link, not an API route.
 */
export function guildIconUrl(guildId: string, iconHash: string): string {
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.png`;
}

/**
 * A file sent with a message as `files[n]`, where `n` is its place in the
 * list. Discord's limit is 20 MiB per file and 25 MiB per request.
 * https://docs.discord.com/developers/reference#uploading-files
 */
export interface FileUpload {
  /** The attachment's file name, which `attachment://<name>` refers to. */
  name: string;
  data: Uint8Array;
  /** The file's media type, such as `image/png`. */
  contentType: string;
}

/**
 * `bytes` as image data, the data URI Discord takes for an image field such
 * as a scheduled event's cover: JPG, GIF or PNG.
 * https://docs.discord.com/developers/reference#image-data
 */
export function imageData(bytes: Uint8Array, contentType: string): string {
  let binary = "";
  // In slices, so the spread stays far within the engine's argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
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
  /** A form body, sent as `application/x-www-form-urlencoded`. */
  form?: Record<string, string>;
  /**
   * Files to upload with `body`: both go as `multipart/form-data`, the body
   * as `payload_json` and each file as `files[n]`.
   */
  files?: readonly FileUpload[];
  /** Send the bot token. False for interaction webhook routes. */
  auth: boolean;
  /**
   * The `Authorization` value of an OAuth2 route (client credentials or a
   * user's access token), in place of the bot token.
   */
  authorization?: string;
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

  /**
   * Posts a message, with `files` as its attachments when given (see
   * `withFiles`).
   */
  createMessage(
    channelId: string,
    body: RESTPostAPIChannelMessageJSONBody,
    files?: readonly FileUpload[],
  ): Promise<RESTPostAPIChannelMessageResult> {
    return this.call({
      method: "POST",
      path: `/channels/${channelId}/messages`,
      body: withFiles(withoutPings(body), files),
      files,
      auth: true,
    });
  }

  /**
   * Edits a message. Without `files` and without `attachments` in `body`,
   * Discord keeps the message's attachments as they are. With `files`, they
   * replace them: only the new files and the attachments `body` lists by id
   * stay (see `withFiles`).
   */
  editMessage(
    channelId: string,
    messageId: string,
    body: RESTPatchAPIChannelMessageJSONBody,
    files?: readonly FileUpload[],
  ): Promise<RESTPatchAPIChannelMessageResult> {
    return this.call({
      method: "PATCH",
      path: `/channels/${channelId}/messages/${messageId}`,
      body: withFiles(withoutPings(body), files),
      files,
      auth: true,
    });
  }

  /**
   * Edits a thread's settings, such as `archived`. Archived threads take no
   * message edits ("Users cannot edit messages, add reactions, use
   * application commands, or join archived threads.",
   * https://docs.discord.com/developers/topics/threads),
   * so an edit there unarchives the thread with `{ archived: false }` first.
   */
  editThread(
    threadId: string,
    body: RESTPatchAPIChannelJSONBody,
  ): Promise<RESTPatchAPIChannelResult> {
    return this.call({
      method: "PATCH",
      path: `/channels/${threadId}`,
      body,
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

  /**
   * Edits a scheduled event, such as its description, or its cover `image`
   * (image data from `imageData`; null removes it).
   */
  editGuildScheduledEvent(
    guildId: string,
    eventId: string,
    body: RESTPatchAPIGuildScheduledEventJSONBody,
  ): Promise<RESTPatchAPIGuildScheduledEventResult> {
    return this.call({
      method: "PATCH",
      path: `/guilds/${guildId}/scheduled-events/${eventId}`,
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

  /**
   * The guild's roles, `@everyone` among them (its id is the guild's).
   * https://docs.discord.com/developers/resources/guild#get-guild-roles
   */
  getGuildRoles(guildId: string): Promise<RESTGetAPIGuildRolesResult> {
    return this.call({
      method: "GET",
      path: `/guilds/${guildId}/roles`,
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

  // OAuth2, for web sign-in: the authorization code grant. These routes
  // carry the application's client credentials or a user's access token in
  // place of the bot token, never in the path, so errors name no secret.
  // https://discord.com/developers/docs/topics/oauth2#authorization-code-grant

  /** Exchanges an authorization code for the user's access token. */
  exchangeOAuthCode(
    client: OAuthClient,
    code: string,
    redirectUri: string,
  ): Promise<RESTPostOAuth2AccessTokenResult> {
    return this.call({
      method: "POST",
      path: "/oauth2/token",
      form: {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      },
      auth: false,
      authorization: basicAuth(client),
    });
  }

  /** Revokes a user's access token, ending the application's access. */
  async revokeOAuthToken(client: OAuthClient, token: string): Promise<void> {
    await this.call({
      method: "POST",
      path: "/oauth2/token/revoke",
      form: { token, token_type_hint: "access_token" },
      auth: false,
      authorization: basicAuth(client),
    });
  }

  /** The user an access token belongs to (scope `identify`). */
  getOAuthUser(accessToken: string): Promise<RESTGetAPICurrentUserResult> {
    return this.call({
      method: "GET",
      path: "/users/@me",
      auth: false,
      authorization: `Bearer ${accessToken}`,
    });
  }

  /**
   * The servers of the user an access token belongs to (scope `guilds`):
   * the first 200, which is as many as a user can join.
   */
  getOAuthUserGuilds(
    accessToken: string,
  ): Promise<RESTGetAPICurrentUserGuildsResult> {
    return this.call({
      method: "GET",
      path: "/users/@me/guilds",
      auth: false,
      authorization: `Bearer ${accessToken}`,
    });
  }

  /**
   * One page of the servers the bot is in, in id order: up to `limit` (at
   * most 200) after the id `after`.
   */
  getBotGuilds(
    query: Pick<RESTGetAPICurrentUserGuildsQuery, "after" | "limit"> = {},
  ): Promise<RESTGetAPICurrentUserGuildsResult> {
    const params = new URLSearchParams();
    if (query.after !== undefined) params.set("after", query.after);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    const search = params.size > 0 ? `?${params.toString()}` : "";
    return this.call({
      method: "GET",
      path: `/users/@me/guilds${search}`,
      route: "/users/@me/guilds",
      auth: true,
    });
  }

  private async call<T>(call: Call): Promise<T> {
    const route = call.route ?? call.path;
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (call.auth) headers.Authorization = `Bot ${this.token}`;
    if (call.authorization !== undefined) {
      headers.Authorization = call.authorization;
    }
    let body: string | FormData | undefined;
    if (call.files !== undefined && call.files.length > 0) {
      // fetch sets the multipart Content-Type with its boundary.
      const form = new FormData();
      form.append("payload_json", JSON.stringify(call.body ?? {}));
      call.files.forEach((file, n) => {
        form.append(
          `files[${String(n)}]`,
          new Blob([file.data], { type: file.contentType }),
          file.name,
        );
      });
      body = form;
    } else if (call.form !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(call.form).toString();
    } else if (call.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(call.body);
    }
    const init: RequestInit = { method: call.method, headers, body };

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

/** HTTP Basic credentials, `client_id:client_secret`, for OAuth2 routes. */
function basicAuth(client: OAuthClient): string {
  return `Basic ${btoa(`${client.id}:${client.secret}`)}`;
}

/**
 * `body` with an `attachments` entry for each of `files`, its id the file's
 * `n` in `files[n]`, after the existing attachments `body` keeps. Unchanged
 * without files.
 * https://docs.discord.com/developers/reference#uploading-files
 */
function withFiles<B extends { attachments?: RESTAPIAttachment[] }>(
  body: B,
  files: readonly FileUpload[] | undefined,
): B {
  if (files === undefined || files.length === 0) return body;
  return {
    ...body,
    attachments: [
      ...(body.attachments ?? []),
      ...files.map((file, n) => ({ id: n, filename: file.name })),
    ],
  };
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
