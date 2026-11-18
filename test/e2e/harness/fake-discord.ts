/**
 * A fake Discord REST API on a local HTTP port. The Worker under test reaches
 * it through DISCORD_API_BASE. It implements the routes the bot uses, keeps
 * guilds, channels, messages, threads, scheduled events and interaction
 * responses in memory so
 * tests can assert on what Discord would now show, and refuses what Discord
 * refuses: a missing bot token (401) and any payload that breaks a rule in
 * `validate.ts` (400 naming the rule).
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { ChannelType, MessageFlags } from "discord-api-types/v10";
import {
  RULES,
  describeViolations,
  validateCommands,
  validateForumThread,
  validateMessage,
  validateScheduledEvent,
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
  owner_id: string;
}

export interface FakeChannel {
  id: string;
  guild_id: string;
  type: ChannelType;
  name: string;
  parent_id?: string;
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
}

/** Discord allows this many SCHEDULED or ACTIVE events per guild. */
export const MAX_SCHEDULED_EVENTS = 100;

/** A message as the fake stores it, with the fields tests read. */
export interface FakeMessage {
  id: string;
  channel_id: string;
  flags: number;
  content: string;
  embeds: unknown[];
  components: unknown[];
  /** True for a message only the interacting user sees. */
  ephemeral: boolean;
  /** The token of the interaction this message answers, if any. */
  interaction_token?: string;
  /** How many times the message was edited. */
  edits: number;
}

export interface RecordedRequest {
  method: string;
  /** Path below the API base, with the query string, e.g. `/channels/1/messages`. */
  path: string;
  /** The path with interaction tokens replaced by `:token`. */
  route: string;
  headers: Record<string, string | undefined>;
  body: unknown;
  status: number;
  response: unknown;
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
  /** Every request the fake received, in order. */
  readonly requests: RecordedRequest[] = [];
  /** The latest Bulk Overwrite Global Application Commands body. */
  commands: unknown[] = [];

  private readonly guilds = new Map<string, FakeGuild>();
  private readonly channels = new Map<string, FakeChannel>();
  private readonly messages = new Map<string, FakeMessage>();
  private readonly events = new Map<string, FakeScheduledEvent[]>();
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

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  // Configuration.

  addGuild(guild: { id: string; ownerId: string; name?: string }): FakeGuild {
    const stored = {
      id: guild.id,
      name: guild.name ?? `Guild ${guild.id}`,
      owner_id: guild.ownerId,
    };
    this.guilds.set(guild.id, stored);
    return stored;
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

  /** Makes every request on the channel fail as Discord would. */
  failChannel(channelId: string, failure: ChannelFailure): void {
    this.failures.set(channelId, failure);
  }

  clearChannelFailure(channelId: string): void {
    this.failures.delete(channelId);
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
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    try {
      body = raw === "" ? undefined : JSON.parse(raw);
    } catch {
      body = raw;
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
      method,
      path,
      route: path.replace(/^(\/webhooks\/[^/]+\/)[^/?]+/, "$1:token"),
      headers: {
        authorization: req.headers.authorization,
        "content-type": req.headers["content-type"],
        "user-agent": req.headers["user-agent"],
      },
      body,
      status: 0,
      response: undefined,
    };

    const result = this.route(
      method,
      url.pathname,
      url.searchParams,
      req,
      body,
    );
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
  ): Reply {
    const path = pathname.replace(/^\/api\/v10/, "");
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
        return this.editOriginal(applicationId, token, body);
      }
      if (!original && method === "POST") {
        return this.createFollowUp(applicationId, token, query, body);
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
      return this.createMessage(match[1] ?? "", body);
    }
    match = /^\/channels\/([^/]+)\/messages\/([^/]+)$/.exec(path);
    if (match && method === "PATCH") {
      return this.editMessage(match[1] ?? "", match[2] ?? "", body);
    }
    match = /^\/channels\/([^/]+)\/threads$/.exec(path);
    if (match && method === "POST") {
      return this.startForumThread(match[1] ?? "", body);
    }
    match = /^\/guilds\/([^/]+)\/scheduled-events$/.exec(path);
    if (match && method === "POST") {
      return this.createScheduledEvent(match[1] ?? "", body);
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

  private createMessage(channelId: string, body: unknown): Reply {
    const gate = this.channelGate(channelId);
    if (gate) return gate;
    const violations = validateMessage(body);
    if (violations.length > 0) return invalid(violations);
    const message = this.storeMessage(
      channelId,
      body as Record<string, unknown>,
    );
    return { status: 200, body: messageObject(message, this.applicationId) };
  }

  private editMessage(
    channelId: string,
    messageId: string,
    body: unknown,
  ): Reply {
    const gate = this.channelGate(channelId);
    if (gate) return gate;
    const message = this.messages.get(messageId);
    if (message?.channel_id !== channelId) {
      return discordError(404, 10008, "Unknown Message");
    }
    const violations = validateMessage(body, { existingFlags: message.flags });
    if (violations.length > 0) return invalid(violations);
    this.applyEdit(message, body as Record<string, unknown>);
    return { status: 200, body: messageObject(message, this.applicationId) };
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
    events.push(event);
    this.events.set(guildId, events);
    return { status: 200, body: event };
  }

  private editOriginal(
    applicationId: string,
    token: string,
    body: unknown,
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
    const violations = validateMessage(body, { existingFlags: message.flags });
    if (violations.length > 0) return invalid(violations);
    this.applyEdit(message, body as Record<string, unknown>);
    return { status: 200, body: messageObject(message, this.applicationId) };
  }

  private createFollowUp(
    applicationId: string,
    token: string,
    query: URLSearchParams,
    body: unknown,
  ): Reply {
    const record = this.interactions.get(token);
    if (applicationId !== this.applicationId || !record) {
      return discordError(404, 10015, "Unknown Webhook");
    }
    const violations = validateMessage(body);
    if (violations.length > 0) return invalid(violations);
    const message = this.storeMessage(
      record.channelId,
      body as Record<string, unknown>,
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
  ): FakeMessage {
    const flags = typeof body.flags === "number" ? body.flags : 0;
    const message: FakeMessage = {
      id,
      channel_id: channelId,
      flags,
      content: typeof body.content === "string" ? body.content : "",
      embeds: Array.isArray(body.embeds) ? body.embeds : [],
      components: Array.isArray(body.components) ? body.components : [],
      ephemeral: (flags & MessageFlags.Ephemeral) !== 0,
      edits: 0,
    };
    this.messages.set(id, message);
    return message;
  }

  private applyEdit(message: FakeMessage, body: Record<string, unknown>): void {
    if (typeof body.flags === "number") {
      // Edits cannot change whether a message is ephemeral.
      message.flags =
        (body.flags & ~MessageFlags.Ephemeral) |
        (message.flags & MessageFlags.Ephemeral);
    }
    if (typeof body.content === "string") message.content = body.content;
    if (Array.isArray(body.embeds)) message.embeds = body.embeds;
    if (Array.isArray(body.components)) message.components = body.components;
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
  };
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
    icon: null,
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
    attachments: [],
    mentions: [],
    mention_roles: [],
    pinned: false,
    tts: false,
    mention_everyone: false,
  };
}
