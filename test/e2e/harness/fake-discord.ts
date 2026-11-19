/**
 * A fake Discord REST API on a local HTTP port. The Worker under test reaches
 * it through DISCORD_API_BASE. It implements the routes the bot uses, keeps
 * guilds, their members, channels, messages, threads, scheduled events and
 * interaction responses in memory so
 * tests can assert on what Discord would now show, and refuses what Discord
 * refuses: a missing bot token (401) and any payload that breaks a rule in
 * `validate.ts` (400 naming the rule). Message routes take a JSON body or a
 * `multipart/form-data` one, whose `payload_json` field is the JSON body
 * and whose `files[n]` fields are files to attach; the fake keeps each
 * message's attachments and each scheduled event's cover image. It also
 * plays Discord's OAuth2 provider for web sign-in, in
 * `fake-discord-oauth.ts`.
 */
import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { ChannelType, MessageFlags } from "discord-api-types/v10";
import { FakeOAuth, type FakeUser } from "./fake-discord-oauth";
import { nextSequence } from "./outbound";
import {
  RULES,
  decodeImageData,
  describeViolations,
  validateCommands,
  validateForumThread,
  validateMessage,
  validateScheduledEvent,
  validateScheduledEventEdit,
  validateUploadFields,
  validateUploadSize,
  validateThreadEdit,
  type Rule,
  type Violation,
} from "./validate";

/** Discord's JSON error codes for the failures tests can configure. */
export const CHANNEL_FAILURES = {
  /** 403, code 50001: the bot cannot see the channel. */
  "missing-access": { status: 403, code: 50001, message: "Missing Access" },
  /** 403, code 50013: the bot lacks a permission in the channel. */
  "missing-permissions": {
    status: 403,
    code: 50013,
    message: "Missing Permissions",
  },
  /** 404, code 10003: the channel was deleted. */
  "unknown-channel": { status: 404, code: 10003, message: "Unknown Channel" },
} as const;

export type ChannelFailure = keyof typeof CHANNEL_FAILURES;

export interface FakeGuild {
  id: string;
  name: string;
  /** The icon's hash, null without one. */
  icon: string | null;
  owner_id: string;
}

export interface FakeChannel {
  id: string;
  guild_id: string;
  type: ChannelType;
  name: string;
  parent_id?: string;
  /** A thread's state: archived threads take no message edits. */
  thread_metadata?: { archived: boolean; locked: boolean };
}

/** A guild scheduled event as the fake stores and returns it. */
export interface FakeScheduledEvent {
  id: string;
  guild_id: string;
  channel_id: string | null;
  creator_id: string;
  name: string;
  description: string | null;
  scheduled_start_time: string;
  scheduled_end_time: string | null;
  privacy_level: number;
  /** 1, SCHEDULED. */
  status: number;
  entity_type: number;
  entity_id: string | null;
  entity_metadata: { location?: string } | null;
  /**
   * "the cover image hash of the scheduled event", null without one; the
   * fake's hash is the SHA-1 of the image's bytes, which
   * `scheduledEventImage` returns.
   */
  image: string | null;
}

/** Discord allows this many SCHEDULED or ACTIVE events per guild. */
export const MAX_SCHEDULED_EVENTS = 100;

/** A file attached to a message, as the fake stores it. */
export interface FakeAttachment {
  id: string;
  filename: string;
  content_type: string;
  /** The file's size in bytes. */
  size: number;
  /** The file itself. */
  bytes: Uint8Array;
}

/** A message as the fake stores it, with the fields tests read. */
export interface FakeMessage {
  id: string;
  channel_id: string;
  flags: number;
  content: string;
  embeds: unknown[];
  components: unknown[];
  /** The files attached to the message, in order. */
  attachments: FakeAttachment[];
  /** True for a message only the interacting user sees. */
  ephemeral: boolean;
  /** The token of the interaction this message answers, if any. */
  interaction_token?: string;
  /** How many times the message was edited. */
  edits: number;
}

/** A file of a multipart request, as `RecordedRequest.files` lists it. */
export interface RecordedFile {
  /** The form field's name, such as `files[0]`. */
  field: string;
  filename: string;
  contentType: string;
  /** The file's size in bytes. */
  size: number;
}

export interface RecordedRequest {
  /** Its place in the outbound request log (`./outbound.ts`). */
  seq: number;
  /** `Date.now()` when the fake recorded it, after any hold. */
  at: number;
  method: string;
  /** Path below the API base, with the query string, e.g. `/channels/1/messages`. */
  path: string;
  /** The path with interaction tokens replaced by `:token`. */
  route: string;
  headers: Record<string, string | undefined>;
  /**
   * The parsed JSON body; for a `multipart/form-data` request, its
   * `payload_json` field parsed.
   */
  body: unknown;
  /** The files of a `multipart/form-data` request, in order. */
  files?: RecordedFile[];
  status: number;
  response: unknown;
}

/** A file field of a `multipart/form-data` request. */
interface UploadedFile {
  field: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

/** What a `multipart/form-data` request carried besides its JSON body. */
interface Upload {
  files: UploadedFile[];
  /** The whole request body's size in bytes. */
  size: number;
}

interface InteractionRecord {
  token: string;
  guildId: string | undefined;
  channelId: string;
  originalId?: string;
  followUpIds: string[];
}

interface RateLimit {
  method: string;
  path: string | RegExp;
  retryAfter: number;
}

type Waiter = {
  match: (request: RecordedRequest) => boolean;
  resolve: (request: RecordedRequest) => void;
};

export interface FakeDiscordOptions {
  botToken: string;
  applicationId: string;
  /** The OAuth2 client secret; without it the token routes refuse all. */
  clientSecret?: string;
  /** The OAuth2 redirect URIs registered for the application. */
  redirectUris?: string[];
}

let nextSnowflake = 1_300_000_000_000_000_000n;

/** A new id that sorts after every id issued before it. */
export function snowflake(): string {
  nextSnowflake += 1n;
  return String(nextSnowflake);
}

export class FakeDiscord {
  readonly botToken: string;
  readonly applicationId: string;
  /** Discord's OAuth2 side: users, codes and tokens. */
  readonly oauth: FakeOAuth;
  /** Every request the fake received, in order. */
  readonly requests: RecordedRequest[] = [];
  /** The latest Bulk Overwrite Global Application Commands body. */
  commands: unknown[] = [];

  private readonly guilds = new Map<string, FakeGuild>();
  /** Each guild's members: role ids by user id. */
  private readonly members = new Map<string, Map<string, string[]>>();
  private readonly channels = new Map<string, FakeChannel>();
  private readonly messages = new Map<string, FakeMessage>();
  private readonly events = new Map<string, FakeScheduledEvent[]>();
  /** Each scheduled event's cover image, by `<guild id>/<event id>`. */
  private readonly eventImages = new Map<string, Uint8Array>();
  /** Channels whose next upload fails, with the status it fails with. */
  private readonly failingUploads = new Map<string, 413 | 500>();
  /** Guilds where the bot lacks Create Events. */
  private readonly withoutCreateEvents = new Set<string>();
  private readonly interactions = new Map<string, InteractionRecord>();
  /** Interactions on their way to the Worker, by token; see `sendingInteraction`. */
  private readonly sending = new Map<string, () => void>();
  private readonly answered = new Map<string, Promise<void>>();
  private held = 0;
  private readonly failures = new Map<string, ChannelFailure>();
  private readonly heldPosts = new Map<string, Promise<void>>();
  private readonly rateLimits: RateLimit[] = [];
  private readonly waiters: Waiter[] = [];
  private unexpected: RecordedRequest[] = [];
  private server = createServer((req, res) => {
    void this.handle(req, res);
  });
  private origin = "";

  constructor(options: FakeDiscordOptions) {
    this.botToken = options.botToken;
    this.applicationId = options.applicationId;
    this.oauth = new FakeOAuth({
      applicationId: options.applicationId,
      clientSecret: options.clientSecret,
      botToken: options.botToken,
      redirectUris: options.redirectUris ?? [],
      botGuilds: () => [...this.guilds.values()],
    });
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const { port } = this.server.address() as AddressInfo;
    this.origin = `http://127.0.0.1:${String(port)}`;
  }

  /** The value for DISCORD_API_BASE. */
  get apiBase(): string {
    return `${this.origin}/api/v10`;
  }

  /** The value for DISCORD_OAUTH_AUTHORIZE_URL. */
  get authorizeUrl(): string {
    return `${this.origin}/oauth2/authorize`;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  // Configuration.

  /** Adds a guild; its owner is a member, without roles unless added. */
  addGuild(guild: {
    id: string;
    ownerId: string;
    name?: string;
    icon?: string | null;
  }): FakeGuild {
    const stored = {
      id: guild.id,
      name: guild.name ?? `Guild ${guild.id}`,
      icon: guild.icon ?? null,
      owner_id: guild.ownerId,
    };
    this.guilds.set(guild.id, stored);
    const members = this.members.get(guild.id) ?? new Map<string, string[]>();
    if (!members.has(guild.ownerId)) members.set(guild.ownerId, []);
    this.members.set(guild.id, members);
    return stored;
  }

  /**
   * Makes `userId` a member of the guild holding `roleIds`, replacing the
   * roles they held. Get Guild Member answers 404 for anyone else.
   */
  addMember(guildId: string, userId: string, roleIds: string[] = []): void {
    const members = this.members.get(guildId) ?? new Map<string, string[]>();
    members.set(userId, [...roleIds]);
    this.members.set(guildId, members);
  }

  /** Takes `userId` out of the guild, as when they leave or are kicked. */
  removeMember(guildId: string, userId: string): void {
    this.members.get(guildId)?.delete(userId);
  }

  addChannel(channel: {
    id: string;
    guildId: string;
    type?: ChannelType;
    name?: string;
  }): FakeChannel {
    const stored = {
      id: channel.id,
      guild_id: channel.guildId,
      type: channel.type ?? ChannelType.GuildText,
      name: channel.name ?? `channel-${channel.id}`,
    };
    this.channels.set(channel.id, stored);
    return stored;
  }

  /**
   * Adds a Discord user who can sign in to the web site, with the servers
   * they are in; the bot is in those added with `addGuild`.
   */
  addUser(user: FakeUser): FakeUser {
    return this.oauth.addUser(user);
  }

  /** Makes every request on the channel fail as Discord would. */
  failChannel(channelId: string, failure: ChannelFailure): void {
    this.failures.set(channelId, failure);
  }

  clearChannelFailure(channelId: string): void {
    this.failures.delete(channelId);
  }

  /**
   * Makes the next message request that uploads files (a
   * `multipart/form-data` create or edit with a `files[n]`) in the channel,
   * or in any thread of it when it is a forum, fail as Discord would: 500
   * Internal Server Error, or with 413 a "Request entity too large" (code
   * 40005). The refusal is one the test set up, not counted as unexpected.
   */
  failNextUpload(channelId: string, status: 413 | 500 = 500): void {
    this.failingUploads.set(channelId, status);
  }

  /**
   * Archives a thread, as Discord does after its inactivity period or a
   * moderator does by hand; `locked` locks it too.
   */
  archiveThread(threadId: string, locked = false): void {
    const thread = this.channels.get(threadId);
    if (!thread?.thread_metadata)
      throw new Error(`${threadId} is not a thread`);
    thread.thread_metadata = { archived: true, locked };
  }

  /**
   * Deletes a channel or thread with its messages, as a member with Manage
   * Channels or Manage Threads does; requests on it then answer 404, code
   * 10003, Unknown Channel.
   */
  deleteChannel(channelId: string): void {
    this.channels.delete(channelId);
    for (const [id, message] of this.messages) {
      if (message.channel_id === channelId) this.messages.delete(id);
    }
  }

  /**
   * Deletes a scheduled event, as a member with Manage Events does; editing
   * it then answers 404, code 10070.
   */
  deleteScheduledEvent(guildId: string, eventId: string): void {
    this.events.set(
      guildId,
      (this.events.get(guildId) ?? []).filter((e) => e.id !== eventId),
    );
  }

  /**
   * Takes the Create Events permission from the bot in the guild, so
   * creating a scheduled event fails with 403 Missing Permissions.
   */
  revokeCreateEvents(guildId: string): void {
    this.withoutCreateEvents.add(guildId);
  }

  grantCreateEvents(guildId: string): void {
    this.withoutCreateEvents.delete(guildId);
  }

  /**
   * Adds `count` scheduled events to the guild as if members had made
   * them, for example to reach Discord's limit of 100.
   */
  seedScheduledEvents(guildId: string, count: number): void {
    const events = this.events.get(guildId) ?? [];
    for (let i = 0; i < count; i++) {
      events.push(
        scheduledEvent(guildId, "400000000000000999", {
          name: `Event ${String(events.length + 1)}`,
          privacy_level: 2,
          scheduled_start_time: "2030-01-01T10:00:00.000Z",
          scheduled_end_time: "2030-01-01T12:00:00.000Z",
          entity_type: 3,
          entity_metadata: { location: "Somewhere" },
        }),
      );
    }
    this.events.set(guildId, events);
  }

  /**
   * Holds every new message posted in the channel until the returned
   * function is called, so a scenario can act while the bot's post is in
   * flight. A failure set meanwhile with `failChannel` applies to the held
   * posts.
   */
  holdChannelPosts(channelId: string): () => void {
    let release: () => void = () => undefined;
    this.heldPosts.set(
      channelId,
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    return () => {
      this.heldPosts.delete(channelId);
      release();
    };
  }

  /**
   * Answers the next request matching `method` and `path` (below the API
   * base) with a 429 asking the client to wait `retryAfter` seconds.
   */
  rateLimitOnce(
    method: string,
    path: string | RegExp,
    retryAfter: number,
  ): void {
    this.rateLimits.push({ method, path, retryAfter });
  }

  /**
   * Stores a message as if the bot had posted it earlier, for example before
   * a deploy changed its handlers. Throws if Discord would refuse it.
   */
  seedMessage(channelId: string, body: Record<string, unknown>): FakeMessage {
    const violations = validateMessage(body);
    if (violations.length > 0) {
      throw new Error(describeViolations(violations));
    }
    return this.storeMessage(channelId, body);
  }

  /**
   * Tells the fake that the client is sending the interaction with `token`
   * to the Worker. Until the client calls `recordInteractionResponse` or
   * `sentInteraction`, the fake holds webhook requests for that token:
   * Discord has processed an interaction's response by the time the bot
   * calls a webhook with its token, but here the Worker's follow-up job can
   * reach the fake before the client has read the response.
   */
  sendingInteraction(token: string): void {
    this.answered.set(
      token,
      new Promise((resolve) => {
        this.sending.set(token, resolve);
      }),
    );
  }

  /**
   * Releases webhook requests held for `token`. The client calls it once it
   * is done with the interaction, also when the Worker's answer failed;
   * requests for an interaction never recorded then get Unknown Webhook.
   */
  sentInteraction(token: string): void {
    this.sending.get(token)?.();
    this.sending.delete(token);
    this.answered.delete(token);
  }

  /**
   * Tells the fake about an interaction the test sent, so its webhook routes
   * accept the token, and records the Worker's response as Discord would
   * show it. The interaction client calls this.
   */
  recordInteractionResponse(
    interaction: {
      token: string;
      guild_id?: string;
      channel_id?: string;
      message?: { id: string };
    },
    response: { type: number; data?: unknown },
  ): void {
    const record: InteractionRecord = this.interactions.get(
      interaction.token,
    ) ?? {
      token: interaction.token,
      guildId: interaction.guild_id,
      channelId: interaction.channel_id ?? "",
      followUpIds: [],
    };
    this.interactions.set(interaction.token, record);
    const data = (response.data ?? {}) as Record<string, unknown>;
    const flags = typeof data.flags === "number" ? data.flags : 0;
    switch (response.type) {
      case 4:
      case 5: {
        const message = this.storeMessage(record.channelId, {
          ...(response.type === 4 ? data : {}),
          flags: response.type === 4 ? flags : flags & MessageFlags.Ephemeral,
        });
        message.interaction_token = interaction.token;
        record.originalId = message.id;
        break;
      }
      case 6:
      case 7: {
        // After an update, deferred or not, the interaction's original
        // response is the message its component (or modal) was on.
        const target = interaction.message
          ? this.messages.get(interaction.message.id)
          : undefined;
        if (target) {
          record.originalId = target.id;
          if (response.type === 7) this.applyEdit(target, data);
        }
        break;
      }
      default:
        break;
    }
    this.sentInteraction(interaction.token);
  }

  // Reading state.

  guild(id: string): FakeGuild | undefined {
    return this.guilds.get(id);
  }

  channel(id: string): FakeChannel | undefined {
    return this.channels.get(id);
  }

  /** The messages everyone sees in a channel or thread, oldest first. */
  channelMessages(channelId: string): FakeMessage[] {
    return [...this.messages.values()].filter(
      (m) => m.channel_id === channelId && !m.ephemeral,
    );
  }

  message(id: string): FakeMessage | undefined {
    return this.messages.get(id);
  }

  /** The guild's scheduled events, oldest first. */
  scheduledEvents(guildId: string): FakeScheduledEvent[] {
    return [...(this.events.get(guildId) ?? [])];
  }

  /** The bytes of the event's cover image, undefined without one. */
  scheduledEventImage(
    guildId: string,
    eventId: string,
  ): Uint8Array | undefined {
    return this.eventImages.get(`${guildId}/${eventId}`);
  }

  /** Threads started in a forum channel, oldest first. */
  threads(forumChannelId: string): FakeChannel[] {
    return [...this.channels.values()].filter(
      (c) => c.parent_id === forumChannelId,
    );
  }

  /**
   * How many requests are held: webhook requests waiting for their
   * interaction's response, and posts held by `holdChannelPosts`.
   */
  get heldRequests(): number {
    return this.held;
  }

  /** The original response to an interaction, after any edits. */
  originalResponse(token: string): FakeMessage | undefined {
    const id = this.interactions.get(token)?.originalId;
    return id === undefined ? undefined : this.messages.get(id);
  }

  followUps(token: string): FakeMessage[] {
    return (this.interactions.get(token)?.followUpIds ?? []).flatMap((id) => {
      const m = this.messages.get(id);
      return m ? [m] : [];
    });
  }

  /**
   * Requests the fake refused because they broke Discord's rules (400, 401)
   * or used a route it does not know (404 without a configured failure).
   * The harness fails a test that leaves any behind; a test that provokes
   * them on purpose takes them with this method.
   */
  takeRejections(): RecordedRequest[] {
    const taken = this.unexpected;
    this.unexpected = [];
    return taken;
  }

  /**
   * Resolves with the first recorded request (already received or still to
   * come) that `match` accepts. Fails after `timeoutMs`.
   */
  nextRequest(
    match: (request: RecordedRequest) => boolean,
    timeoutMs = 5_000,
  ): Promise<RecordedRequest> {
    const seen = this.requests.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve: (request) => {
          clearTimeout(deadline);
          resolve(request);
        },
      };
      const deadline = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(
          new Error(
            `no matching request reached the fake Discord API within ${String(timeoutMs)} ms; it received: ${this.requests.map((r) => `${r.method} ${r.route} -> ${String(r.status)}`).join(", ") || "nothing"}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  // HTTP.

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    const contentType = req.headers["content-type"] ?? "";
    let body: unknown;
    let upload: Upload | undefined;
    if (/^multipart\/form-data\b/i.test(contentType)) {
      ({ body, upload } = readMultipart(bytes, contentType));
    } else {
      const raw = bytes.toString("utf8");
      try {
        body = raw === "" ? undefined : JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const url = new URL(req.url ?? "/", this.origin);
    const method = req.method ?? "GET";
    const path = url.pathname.replace(/^\/api\/v10/, "") + url.search;
    const token = /^\/webhooks\/[^/]+\/([^/?]+)/.exec(path)?.[1];
    const answered = token === undefined ? undefined : this.answered.get(token);
    if (answered) {
      this.held += 1;
      await answered;
      this.held -= 1;
    }
    const postedIn =
      method === "POST"
        ? /^\/channels\/([^/]+)\/messages$/.exec(path)?.[1]
        : undefined;
    const heldPost =
      postedIn === undefined ? undefined : this.heldPosts.get(postedIn);
    if (heldPost) {
      this.held += 1;
      await heldPost;
      this.held -= 1;
    }
    const recorded: RecordedRequest = {
      seq: 0,
      at: 0,
      method,
      path,
      route: path.replace(/^(\/webhooks\/[^/]+\/)[^/?]+/, "$1:token"),
      headers: {
        authorization: req.headers.authorization,
        "content-type": req.headers["content-type"],
        "user-agent": req.headers["user-agent"],
      },
      body,
      ...(upload && {
        files: upload.files.map((file) => ({
          field: file.field,
          filename: file.filename,
          contentType: file.contentType,
          size: file.bytes.length,
        })),
      }),
      status: 0,
      response: undefined,
    };

    const result = this.route(
      method,
      url.pathname,
      url.searchParams,
      req,
      body,
      upload,
    );
    recorded.seq = nextSequence();
    recorded.at = Date.now();
    recorded.status = result.status;
    recorded.response = result.body;
    if (result.unexpected) this.unexpected.push(recorded);
    this.requests.push(recorded);
    for (const waiter of [...this.waiters]) {
      if (waiter.match(recorded)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(recorded);
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...result.headers,
    };
    res.writeHead(result.status, headers);
    res.end(result.status === 204 ? undefined : JSON.stringify(result.body));
  }

  private route(
    method: string,
    pathname: string,
    query: URLSearchParams,
    req: IncomingMessage,
    body: unknown,
    upload: Upload | undefined,
  ): Reply {
    const path = pathname.replace(/^\/api\/v10/, "");
    const oauth = this.oauth.route(method, pathname, query, req, body);
    if (oauth) return oauth;
    if (!pathname.startsWith("/api/v10/")) {
      return notFound("the API base must end in /api/v10");
    }

    const limited = this.rateLimits.findIndex(
      (limit) =>
        limit.method === method &&
        (typeof limit.path === "string"
          ? limit.path === path
          : limit.path.test(path)),
    );
    if (limited !== -1) {
      const [limit] = this.rateLimits.splice(limited, 1);
      const retryAfter = limit?.retryAfter ?? 0;
      return {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(retryAfter)),
          "X-RateLimit-Scope": "user",
        },
        body: {
          message: "You are being rate limited.",
          retry_after: retryAfter,
          global: false,
        },
      };
    }

    const webhook =
      /^\/webhooks\/([^/]+)\/([^/]+)(\/messages\/@original)?$/.exec(path);
    if (webhook) {
      const [, applicationId = "", token = "", original] = webhook;
      if (original && method === "PATCH") {
        return this.editOriginal(applicationId, token, body, upload);
      }
      if (!original && method === "POST") {
        return this.createFollowUp(applicationId, token, query, body, upload);
      }
      return notFound(`${method} is not implemented on this webhook route`);
    }

    if (req.headers.authorization !== `Bot ${this.botToken}`) {
      return {
        status: 401,
        unexpected: true,
        body: {
          message: "401: Unauthorized",
          code: 0,
          rule: "bot routes need the header Authorization: Bot <token>",
        },
      };
    }

    let match = /^\/channels\/([^/]+)\/messages$/.exec(path);
    if (match && method === "POST") {
      return this.createMessage(match[1] ?? "", body, upload);
    }
    match = /^\/channels\/([^/]+)\/messages\/([^/]+)$/.exec(path);
    if (match && method === "PATCH") {
      return this.editMessage(match[1] ?? "", match[2] ?? "", body, upload);
    }
    match = /^\/channels\/([^/]+)\/threads$/.exec(path);
    if (match && method === "POST") {
      return this.startForumThread(match[1] ?? "", body);
    }
    match = /^\/channels\/([^/]+)$/.exec(path);
    if (match && method === "PATCH") {
      return this.modifyThread(match[1] ?? "", body);
    }
    match = /^\/guilds\/([^/]+)\/scheduled-events$/.exec(path);
    if (match && method === "POST") {
      return this.createScheduledEvent(match[1] ?? "", body);
    }
    match = /^\/guilds\/([^/]+)\/members\/([^/]+)$/.exec(path);
    if (match && method === "GET") {
      return this.getGuildMember(match[1] ?? "", match[2] ?? "");
    }
    match = /^\/guilds\/([^/]+)\/channels$/.exec(path);
    if (match && method === "GET") {
      return this.getGuildChannels(match[1] ?? "");
    }
    match = /^\/guilds\/([^/]+)\/scheduled-events\/([^/]+)$/.exec(path);
    if (match && method === "PATCH") {
      return this.editScheduledEvent(match[1] ?? "", match[2] ?? "", body);
    }
    match = /^\/guilds\/([^/]+)$/.exec(path);
    if (match && method === "GET") {
      const guild = this.guilds.get(match[1] ?? "");
      return guild
        ? { status: 200, body: guildObject(guild) }
        : discordError(404, 10004, "Unknown Guild");
    }
    match = /^\/applications\/([^/]+)\/commands$/.exec(path);
    if (match && method === "PUT") {
      if (match[1] !== this.applicationId) {
        return discordError(404, 10002, "Unknown Application");
      }
      const violations = validateCommands(body);
      if (violations.length > 0) return invalid(violations);
      this.commands = (body as unknown[]).map((command) => ({
        id: snowflake(),
        application_id: this.applicationId,
        version: snowflake(),
        ...(command as object),
      }));
      return { status: 200, body: this.commands };
    }
    return notFound(`the fake does not implement ${method} ${path}`);
  }

  private channelGate(channelId: string): Reply | undefined {
    const failure = this.failures.get(channelId);
    if (failure) {
      const { status, code, message } = CHANNEL_FAILURES[failure];
      return discordError(status, code, message);
    }
    if (!this.channels.has(channelId)) {
      return discordError(404, 10003, "Unknown Channel");
    }
    return undefined;
  }

  private createMessage(
    channelId: string,
    body: unknown,
    upload: Upload | undefined,
  ): Reply {
    const gate =
      this.channelGate(channelId) ?? this.uploadGate(channelId, upload);
    if (gate) return gate;
    const { attachments, violations } = withAttachments(body, upload);
    violations.push(
      ...validateMessage(body, {
        attachments: attachments.map((a) => a.filename),
      }),
    );
    if (violations.length > 0) return invalid(violations);
    const message = this.storeMessage(
      channelId,
      body as Record<string, unknown>,
      snowflake(),
      attachments,
    );
    return { status: 200, body: messageObject(message, this.applicationId) };
  }

  private editMessage(
    channelId: string,
    messageId: string,
    body: unknown,
    upload: Upload | undefined,
  ): Reply {
    const gate =
      this.channelGate(channelId) ?? this.uploadGate(channelId, upload);
    if (gate) return gate;
    const message = this.messages.get(messageId);
    if (message?.channel_id !== channelId) {
      return discordError(404, 10008, "Unknown Message");
    }
    if (this.channels.get(channelId)?.thread_metadata?.archived) {
      return refusal(400, 50083, "Thread is archived", RULES.archivedThread);
    }
    return this.edit(message, body, upload);
  }

  /** Edits `message` as Edit Message and the webhook edit do. */
  private edit(
    message: FakeMessage,
    body: unknown,
    upload: Upload | undefined,
  ): Reply {
    const { attachments, violations } = withAttachments(
      body,
      upload,
      message.attachments,
    );
    violations.push(
      ...validateMessage(body, {
        existingFlags: message.flags,
        attachments: attachments.map((a) => a.filename),
      }),
    );
    if (violations.length > 0) return invalid(violations);
    this.applyEdit(message, body as Record<string, unknown>, attachments);
    return { status: 200, body: messageObject(message, this.applicationId) };
  }

  /**
   * Refuses an upload that is too large, as Discord does with 413, or that
   * `failNextUpload` set up to fail.
   */
  private uploadGate(
    channelId: string,
    upload: Upload | undefined,
  ): Reply | undefined {
    if (upload === undefined) return undefined;
    const tooLarge = validateUploadSize(
      upload.files.map((f) => ({ field: f.field, size: f.bytes.length })),
      upload.size,
    );
    if (tooLarge.length > 0) {
      return {
        ...invalid(tooLarge),
        status: 413,
        body: {
          code: 40005,
          message: `Request entity too large: ${describeViolations(tooLarge)}`,
          errors: tooLarge.map((v) => ({
            rule: v.rule.id,
            path: v.path,
            detail: v.detail,
            docs: v.rule.docs,
          })),
        },
      };
    }
    if (upload.files.length === 0) return undefined;
    const parentId = this.channels.get(channelId)?.parent_id;
    const failing = [channelId, parentId].find(
      (id): id is string => id !== undefined && this.failingUploads.has(id),
    );
    if (failing === undefined) return undefined;
    const status = this.failingUploads.get(failing);
    this.failingUploads.delete(failing);
    return status === 413
      ? discordError(413, 40005, "Request entity too large")
      : discordError(500, 0, "500: Internal Server Error");
  }

  private startForumThread(channelId: string, body: unknown): Reply {
    const gate = this.channelGate(channelId);
    if (gate) return gate;
    const parent = this.channels.get(channelId);
    const violations = validateForumThread(body, parent?.type);
    if (violations.length > 0) return invalid(violations);
    const request = body as { name: string; message: Record<string, unknown> };
    const thread: FakeChannel = {
      id: snowflake(),
      guild_id: parent?.guild_id ?? "",
      type: ChannelType.PublicThread,
      name: request.name,
      parent_id: channelId,
      thread_metadata: { archived: false, locked: false },
    };
    this.channels.set(thread.id, thread);
    // A forum thread's starter message has the thread's id.
    const message = this.storeMessage(thread.id, request.message, thread.id);
    return {
      status: 201,
      body: {
        ...thread,
        message: messageObject(message, this.applicationId),
      },
    };
  }

  /**
   * Modify Channel, for a thread: sets `archived` and `locked`. The bot
   * created the thread, so it may unarchive it even when locked ("If
   * `locked` is true, then the user must have created the thread or have
   * `MANAGE_THREADS`", https://docs.discord.com/developers/topics/threads).
   * https://docs.discord.com/developers/resources/channel#modify-channel
   */
  private modifyThread(channelId: string, body: unknown): Reply {
    const gate = this.channelGate(channelId);
    if (gate) return gate;
    const thread = this.channels.get(channelId);
    if (!thread?.thread_metadata) {
      return notFound(
        "the fake modifies only threads with PATCH /channels/{id}",
      );
    }
    const violations = validateThreadEdit(body);
    if (violations.length > 0) return invalid(violations);
    const o = body as { archived?: boolean; locked?: boolean };
    thread.thread_metadata = {
      archived: o.archived ?? thread.thread_metadata.archived,
      locked: o.locked ?? thread.thread_metadata.locked,
    };
    return { status: 200, body: thread };
  }

  private createScheduledEvent(guildId: string, body: unknown): Reply {
    if (!this.guilds.has(guildId)) {
      return discordError(404, 10004, "Unknown Guild");
    }
    if (this.withoutCreateEvents.has(guildId)) {
      return refusal(
        403,
        50013,
        "Missing Permissions",
        RULES.createEventsPermission,
      );
    }
    const violations = validateScheduledEvent(body);
    if (violations.length > 0) return invalid(violations);
    const events = this.events.get(guildId) ?? [];
    if (events.length >= MAX_SCHEDULED_EVENTS) {
      return refusal(
        400,
        30038,
        "Maximum number of uncompleted guild scheduled events reached (100)",
        RULES.maxScheduledEvents,
      );
    }
    const event = scheduledEvent(
      guildId,
      this.applicationId,
      body as Record<string, unknown>,
    );
    this.setEventImage(event, (body as Record<string, unknown>).image);
    events.push(event);
    this.events.set(guildId, events);
    return { status: 200, body: event };
  }

  /**
   * Get Guild Member: the member with their role ids, or 404 Unknown Member
   * (10007) for a user who is not one.
   * https://docs.discord.com/developers/resources/guild#get-guild-member
   */
  private getGuildMember(guildId: string, userId: string): Reply {
    if (!this.guilds.has(guildId)) {
      return discordError(404, 10004, "Unknown Guild");
    }
    const roles = this.members.get(guildId)?.get(userId);
    if (roles === undefined) return discordError(404, 10007, "Unknown Member");
    return {
      status: 200,
      body: {
        user: { id: userId, username: `user-${userId}`, discriminator: "0" },
        nick: null,
        roles,
        joined_at: "2026-01-01T00:00:00.000Z",
        deaf: false,
        mute: false,
        flags: 0,
      },
    };
  }

  /**
   * Get Guild Channels: the guild's channels, without threads.
   * https://docs.discord.com/developers/resources/guild#get-guild-channels
   */
  private getGuildChannels(guildId: string): Reply {
    if (!this.guilds.has(guildId)) {
      return discordError(404, 10004, "Unknown Guild");
    }
    return {
      status: 200,
      body: [...this.channels.values()].filter(
        (c) => c.guild_id === guildId && c.parent_id === undefined,
      ),
    };
  }

  /**
   * Modify Guild Scheduled Event: changes the fields the body holds; null
   * clears the description. The bot may edit the events it created while
   * it has Create Events.
   */
  private editScheduledEvent(
    guildId: string,
    eventId: string,
    body: unknown,
  ): Reply {
    if (!this.guilds.has(guildId)) {
      return discordError(404, 10004, "Unknown Guild");
    }
    const event = (this.events.get(guildId) ?? []).find(
      (e) => e.id === eventId,
    );
    if (!event) {
      return refusal(
        404,
        10070,
        "Unknown Guild Scheduled Event",
        RULES.unknownScheduledEvent,
      );
    }
    if (
      this.withoutCreateEvents.has(guildId) ||
      event.creator_id !== this.applicationId
    ) {
      return refusal(
        403,
        50013,
        "Missing Permissions",
        RULES.editEventsPermission,
      );
    }
    const violations = validateScheduledEventEdit(body);
    if (violations.length > 0) return invalid(violations);
    const o = body as Record<string, unknown>;
    if (typeof o.name === "string") event.name = o.name;
    if (o.description !== undefined) {
      event.description =
        typeof o.description === "string" ? o.description : null;
    }
    if (o.entity_metadata !== undefined) {
      event.entity_metadata = o.entity_metadata ?? null;
    }
    this.setEventImage(event, o.image);
    return { status: 200, body: event };
  }

  /**
   * Sets the event's cover from validated image data, or removes it for
   * null; leaves it for undefined.
   */
  private setEventImage(event: FakeScheduledEvent, image: unknown): void {
    if (image === undefined) return;
    const key = `${event.guild_id}/${event.id}`;
    const decoded = image === null ? null : decodeImageData(image);
    if (decoded !== null && "bytes" in decoded) {
      this.eventImages.set(key, decoded.bytes);
      event.image = createHash("sha1").update(decoded.bytes).digest("hex");
    } else {
      this.eventImages.delete(key);
      event.image = null;
    }
  }

  private editOriginal(
    applicationId: string,
    token: string,
    body: unknown,
    upload: Upload | undefined,
  ): Reply {
    const record = this.interactions.get(token);
    if (applicationId !== this.applicationId || !record) {
      return discordError(404, 10015, "Unknown Webhook");
    }
    const message =
      record.originalId === undefined
        ? undefined
        : this.messages.get(record.originalId);
    if (!message) return discordError(404, 10008, "Unknown Message");
    return (
      this.uploadGate(message.channel_id, upload) ??
      this.edit(message, body, upload)
    );
  }

  private createFollowUp(
    applicationId: string,
    token: string,
    query: URLSearchParams,
    body: unknown,
    upload: Upload | undefined,
  ): Reply {
    const record = this.interactions.get(token);
    if (applicationId !== this.applicationId || !record) {
      return discordError(404, 10015, "Unknown Webhook");
    }
    const gate = this.uploadGate(record.channelId, upload);
    if (gate) return gate;
    const { attachments, violations } = withAttachments(body, upload);
    violations.push(
      ...validateMessage(body, {
        attachments: attachments.map((a) => a.filename),
      }),
    );
    if (violations.length > 0) return invalid(violations);
    const message = this.storeMessage(
      record.channelId,
      body as Record<string, unknown>,
      snowflake(),
      attachments,
    );
    message.interaction_token = token;
    record.followUpIds.push(message.id);
    return query.get("wait") === "true"
      ? { status: 200, body: messageObject(message, this.applicationId) }
      : { status: 204, body: undefined };
  }

  private storeMessage(
    channelId: string,
    body: Record<string, unknown>,
    id = snowflake(),
    attachments: FakeAttachment[] = [],
  ): FakeMessage {
    const flags = typeof body.flags === "number" ? body.flags : 0;
    const message: FakeMessage = {
      id,
      channel_id: channelId,
      flags,
      content: typeof body.content === "string" ? body.content : "",
      embeds: Array.isArray(body.embeds) ? body.embeds : [],
      components: Array.isArray(body.components) ? body.components : [],
      attachments,
      ephemeral: (flags & MessageFlags.Ephemeral) !== 0,
      edits: 0,
    };
    this.messages.set(id, message);
    return message;
  }

  private applyEdit(
    message: FakeMessage,
    body: Record<string, unknown>,
    attachments?: FakeAttachment[],
  ): void {
    if (typeof body.flags === "number") {
      // Edits cannot change whether a message is ephemeral.
      message.flags =
        (body.flags & ~MessageFlags.Ephemeral) |
        (message.flags & MessageFlags.Ephemeral);
    }
    if (typeof body.content === "string") message.content = body.content;
    if (Array.isArray(body.embeds)) message.embeds = body.embeds;
    if (Array.isArray(body.components)) message.components = body.components;
    if (attachments !== undefined) message.attachments = attachments;
    message.edits += 1;
  }
}

interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  /** A refusal the test did not set up: a broken rule or unknown route. */
  unexpected?: boolean;
}

function discordError(status: number, code: number, message: string): Reply {
  return { status, body: { message, code } };
}

/**
 * A refusal Discord makes in a state a scenario sets up on purpose, such as
 * a missing permission; it names the rule but is not counted as unexpected.
 */
function refusal(
  status: number,
  code: number,
  message: string,
  rule: Rule,
): Reply {
  return { status, body: { message, code, rule: rule.id, docs: rule.docs } };
}

function scheduledEvent(
  guildId: string,
  creatorId: string,
  body: Record<string, unknown>,
): FakeScheduledEvent {
  const metadata = body.entity_metadata as { location?: string } | undefined;
  return {
    id: snowflake(),
    guild_id: guildId,
    channel_id: typeof body.channel_id === "string" ? body.channel_id : null,
    creator_id: creatorId,
    name: String(body.name),
    description: typeof body.description === "string" ? body.description : null,
    scheduled_start_time: String(body.scheduled_start_time),
    scheduled_end_time:
      typeof body.scheduled_end_time === "string"
        ? body.scheduled_end_time
        : null,
    privacy_level: Number(body.privacy_level),
    status: 1,
    entity_type: Number(body.entity_type),
    entity_id: null,
    entity_metadata: metadata ?? null,
    image: null,
  };
}

/**
 * Reads a `multipart/form-data` body: "Non-file parameters can be sent as
 * individual form fields or collectively as JSON in the `payload_json` form
 * field." The JSON body is `payload_json` parsed, or else the other text
 * fields; each file field is kept with its name. A body that is not a valid
 * form reads as no body, which the message rules refuse.
 * https://docs.discord.com/developers/reference#uploading-files
 */
function readMultipart(
  bytes: Buffer,
  contentType: string,
): { body: unknown; upload: Upload } {
  const upload: Upload = { files: [], size: bytes.length };
  const parts = multipartParts(bytes, contentType);
  if (parts === null) return { body: undefined, upload };
  let payload: unknown;
  const fields: Record<string, string> = {};
  for (const part of parts) {
    if (part.filename !== undefined) {
      upload.files.push({
        field: part.name,
        filename: part.filename,
        contentType: part.contentType ?? "application/octet-stream",
        bytes: new Uint8Array(part.content),
      });
    } else if (part.name === "payload_json") {
      const text = part.content.toString("utf8");
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    } else {
      fields[part.name] = part.content.toString("utf8");
    }
  }
  return { body: payload ?? fields, upload };
}

/** One part of a `multipart/form-data` body. */
interface FormPart {
  name: string;
  /** The file name, for a file field. */
  filename?: string;
  contentType?: string;
  content: Buffer;
}

/**
 * Splits a `multipart/form-data` body (RFC 7578) at the boundary its
 * Content-Type names into its parts, or null when it is not one.
 */
function multipartParts(bytes: Buffer, contentType: string): FormPart[] | null {
  const match = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (boundary === undefined) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  const between = Buffer.from(`\r\n--${boundary}`);
  let at = bytes.indexOf(delimiter);
  if (at === -1) return null;
  at += delimiter.length;
  const parts: FormPart[] = [];
  for (;;) {
    const after = bytes.subarray(at, at + 2).toString("latin1");
    if (after === "--") return parts;
    if (after !== "\r\n") return null;
    const next = bytes.indexOf(between, at + 2);
    if (next === -1) return null;
    const part = bytes.subarray(at + 2, next);
    const split = part.indexOf("\r\n\r\n");
    if (split === -1) return null;
    const headers = part.subarray(0, split).toString("utf8");
    const disposition =
      /^content-disposition:\s*form-data(.*)$/im.exec(headers)?.[1] ?? "";
    const name = /;\s*name="([^"]*)"/i.exec(disposition)?.[1];
    if (name === undefined) return null;
    parts.push({
      name,
      filename: /;\s*filename="([^"]*)"/i.exec(disposition)?.[1],
      contentType: /^content-type:\s*(.*)$/im.exec(headers)?.[1]?.trim(),
      content: part.subarray(split + 4),
    });
    at = next + between.length;
  }
}

/**
 * The attachments a message has after a request with `body` and `upload`,
 * and what in them breaks Discord's rules. On create (`existing`
 * undefined), every uploaded `files[n]`. On edit, "Any provided files will
 * be **appended** to the message. To remove or replace files you will have
 * to supply the `attachments` field which specifies the files to retain on
 * the message after edit." Without `attachments`, the message's attachments
 * and the uploaded files; with it, "only files listed in the `attachments`
 * parameter will be appended to the message" and "Any previously-added
 * files that aren't included will be removed": the existing attachments it
 * lists by id and the uploaded files it names by their `n`.
 * https://docs.discord.com/developers/resources/message#edit-message
 */
function withAttachments(
  body: unknown,
  upload: Upload | undefined,
  existing?: readonly FakeAttachment[],
): { attachments: FakeAttachment[]; violations: Violation[] } {
  const files = upload?.files ?? [];
  const violations = validateUploadFields(
    files.map((f) => ({ field: f.field, size: f.bytes.length })),
  );
  const byIndex = new Map<string, UploadedFile>();
  for (const file of files) {
    const n = /^files\[(\d+)\]$/.exec(file.field)?.[1];
    if (n !== undefined && !byIndex.has(n)) byIndex.set(n, file);
  }
  const attach = (file: UploadedFile, filename?: string): FakeAttachment => ({
    id: snowflake(),
    filename: filename ?? file.filename,
    content_type: file.contentType,
    size: file.bytes.length,
    bytes: file.bytes,
  });
  const listed =
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { attachments?: unknown }).attachments)
      ? (body as { attachments: unknown[] }).attachments
      : undefined;
  if (listed === undefined) {
    return {
      attachments: [
        ...(existing ?? []),
        ...[...byIndex.values()].map((file) => attach(file)),
      ],
      violations,
    };
  }
  const attachments: FakeAttachment[] = [];
  const used = new Set<string>();
  listed.forEach((entry, i) => {
    const o = (typeof entry === "object" && entry !== null ? entry : {}) as {
      id?: unknown;
      filename?: unknown;
    };
    const id =
      typeof o.id === "string" || typeof o.id === "number"
        ? String(o.id)
        : undefined;
    const kept = existing?.find((a) => a.id === id);
    if (kept) {
      attachments.push(kept);
      return;
    }
    const file = id === undefined || used.has(id) ? undefined : byIndex.get(id);
    if (id !== undefined && file) {
      used.add(id);
      attachments.push(
        attach(file, typeof o.filename === "string" ? o.filename : undefined),
      );
      return;
    }
    violations.push({
      rule: RULES.attachmentReference,
      path: `attachments[${String(i)}].id`,
      detail: `${JSON.stringify(o.id)} names no uploaded files[n] and no attachment of the message`,
    });
  });
  if (existing === undefined) {
    // A new message gets every file sent with it.
    for (const [n, file] of byIndex) {
      if (!used.has(n)) attachments.push(attach(file));
    }
  }
  return { attachments, violations };
}

function notFound(detail: string): Reply {
  return {
    status: 404,
    unexpected: true,
    body: { message: "404: Not Found", code: 0, rule: detail },
  };
}

function invalid(violations: Violation[]): Reply {
  return {
    status: 400,
    unexpected: true,
    body: {
      code: 50035,
      message: `Invalid Form Body: ${describeViolations(violations)}`,
      errors: violations.map((v) => ({
        rule: v.rule.id,
        path: v.path,
        detail: v.detail,
        docs: v.rule.docs,
      })),
    },
  };
}

function guildObject(guild: FakeGuild): Record<string, unknown> {
  return {
    id: guild.id,
    name: guild.name,
    owner_id: guild.owner_id,
    icon: guild.icon,
    roles: [],
    emojis: [],
    features: [],
  };
}

function messageObject(
  message: FakeMessage,
  applicationId: string,
): Record<string, unknown> {
  return {
    id: message.id,
    channel_id: message.channel_id,
    type: 0,
    author: { id: applicationId, username: "hikebot", bot: true },
    content: message.content,
    embeds: message.embeds,
    components: message.components,
    flags: message.flags,
    timestamp: new Date().toISOString(),
    edited_timestamp: message.edits > 0 ? new Date().toISOString() : null,
    attachments: message.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      size: a.size,
      content_type: a.content_type,
      url: `https://cdn.discordapp.com/attachments/${message.channel_id}/${a.id}/${a.filename}`,
      proxy_url: `https://media.discordapp.net/attachments/${message.channel_id}/${a.id}/${a.filename}`,
    })),
    mentions: [],
    mention_roles: [],
    pinned: false,
    tts: false,
    mention_everyone: false,
  };
}
