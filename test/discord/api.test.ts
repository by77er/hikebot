import { env } from "cloudflare:workers";
import {
  ApplicationCommandType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
  ThreadAutoArchiveDuration,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISCORD_API_BASE,
  DiscordApi,
  DiscordApiError,
  discordApi,
  eventUrl,
  type DiscordApiOptions,
} from "../../src/discord/api";

interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

/** A fetch that records requests and answers with `responses` in order. */
function fakeFetch(...responses: Response[]) {
  const sent: Sent[] = [];
  const fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const text = await request.text();
    sent.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: text === "" ? undefined : JSON.parse(text),
    });
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  };
  return { fetch, sent };
}

function client(
  responses: Response[],
  options: Partial<DiscordApiOptions> = {},
) {
  const fake = fakeFetch(...responses);
  const sleeps: number[] = [];
  const api = new DiscordApi({
    token: "bot-token",
    fetch: fake.fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...options,
  });
  return { api, sent: fake.sent, sleeps };
}

/** The DiscordApiError a call rejects with. */
async function failure(call: Promise<unknown>): Promise<DiscordApiError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof DiscordApiError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

const ok = (body: unknown = { id: "1" }) => Response.json(body);
const rateLimited = (seconds: number) =>
  Response.json(
    {
      message: "You are being rate limited.",
      retry_after: seconds,
      global: false,
    },
    { status: 429 },
  );

const message: RESTPostAPIChannelMessageJSONBody = {
  flags: MessageFlags.IsComponentsV2,
  components: [],
};

describe("DiscordApi routes", () => {
  const base = "https://discord.com/api/v10";
  const scheduledEvent = {
    name: "Ridge",
    privacy_level: GuildScheduledEventPrivacyLevel.GuildOnly,
    scheduled_start_time: "2030-06-15T16:00:00.000Z",
    scheduled_end_time: "2030-06-15T20:00:00.000Z",
    entity_type: GuildScheduledEventEntityType.External,
    entity_metadata: { location: "Ridge" },
  };
  const cases: {
    name: string;
    call: (api: DiscordApi) => Promise<unknown>;
    method: string;
    url: string;
    auth: boolean;
  }[] = [
    {
      name: "createMessage",
      call: (api) => api.createMessage("10", message),
      method: "POST",
      url: `${base}/channels/10/messages`,
      auth: true,
    },
    {
      name: "editMessage",
      call: (api) => api.editMessage("10", "20", message),
      method: "PATCH",
      url: `${base}/channels/10/messages/20`,
      auth: true,
    },
    {
      name: "startForumThread",
      call: (api) => api.startForumThread("30", { name: "Hike", message }),
      method: "POST",
      url: `${base}/channels/30/threads`,
      auth: true,
    },
    {
      name: "createGuildScheduledEvent",
      call: (api) => api.createGuildScheduledEvent("40", scheduledEvent),
      method: "POST",
      url: `${base}/guilds/40/scheduled-events`,
      auth: true,
    },
    {
      name: "getGuild",
      call: (api) => api.getGuild("40"),
      method: "GET",
      url: `${base}/guilds/40`,
      auth: true,
    },
    {
      name: "editOriginalInteractionResponse",
      call: (api) => api.editOriginalInteractionResponse("50", "tok", message),
      method: "PATCH",
      url: `${base}/webhooks/50/tok/messages/@original`,
      auth: false,
    },
    {
      name: "createFollowup",
      call: (api) => api.createFollowup("50", "tok", message),
      method: "POST",
      url: `${base}/webhooks/50/tok?wait=true`,
      auth: false,
    },
    {
      name: "bulkOverwriteGlobalCommands",
      call: (api) =>
        api.bulkOverwriteGlobalCommands("50", [
          {
            name: "hike",
            description: "Hikes",
            type: ApplicationCommandType.ChatInput,
          },
        ]),
      method: "PUT",
      url: `${base}/applications/50/commands`,
      auth: true,
    },
  ];

  for (const { name, call, method, url, auth } of cases) {
    it(`${name} sends ${method} ${new URL(url).pathname}`, async () => {
      const { api, sent } = client([ok({ id: "99" })]);
      expect(await call(api)).toEqual({ id: "99" });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.method).toBe(method);
      expect(sent[0]?.url).toBe(url);
      expect(sent[0]?.headers.get("Authorization")).toBe(
        auth ? "Bot bot-token" : null,
      );
      expect(sent[0]?.headers.get("User-Agent")).toMatch(/^DiscordBot \(/);
    });
  }

  it("getGuild sends no body", async () => {
    const { api, sent } = client([ok({ id: "40", owner_id: "7" })]);
    expect((await api.getGuild("40")).owner_id).toBe("7");
    expect(sent[0]?.body).toBeUndefined();
    expect(sent[0]?.headers.get("Content-Type")).toBeNull();
  });

  it("sends JSON bodies", async () => {
    const { api, sent } = client([ok()]);
    await api.startForumThread("30", {
      name: "Hike",
      message,
      auto_archive_duration: ThreadAutoArchiveDuration.OneDay,
    });
    expect(sent[0]?.headers.get("Content-Type")).toBe("application/json");
    expect(sent[0]?.body).toEqual({
      name: "Hike",
      auto_archive_duration: 1440,
      message: { ...message, allowed_mentions: { parse: [] } },
    });
  });

  it("sends a scheduled event as given, without allowed_mentions", async () => {
    const { api, sent } = client([ok({ id: "60" })]);
    await api.createGuildScheduledEvent("40", scheduledEvent);
    expect(sent[0]?.headers.get("Content-Type")).toBe("application/json");
    expect(sent[0]?.body).toEqual(scheduledEvent);
  });

  it("accepts 204 No Content", async () => {
    const { api } = client([new Response(null, { status: 204 })]);
    await expect(api.getGuild("40")).resolves.toBeUndefined();
  });
});

describe("base URL", () => {
  it("defaults to Discord's v10 API", async () => {
    const { api, sent } = client([ok()]);
    await api.getGuild("1");
    expect(DEFAULT_DISCORD_API_BASE).toBe("https://discord.com/api/v10");
    expect(sent[0]?.url).toBe("https://discord.com/api/v10/guilds/1");
  });

  it("can be overridden", async () => {
    const { api, sent } = client([ok()], {
      baseUrl: "http://fake-discord.test/api/v10/",
    });
    await api.getGuild("1");
    expect(sent[0]?.url).toBe("http://fake-discord.test/api/v10/guilds/1");
  });

  it("comes from DISCORD_API_BASE in the environment", async () => {
    expect(env.DISCORD_API_BASE).toBe(DEFAULT_DISCORD_API_BASE);
    const fake = fakeFetch(ok());
    await discordApi(
      { ...env, DISCORD_API_BASE: "http://fake-discord.test" },
      { fetch: fake.fetch },
    ).getGuild("1");
    expect(fake.sent[0]?.url).toBe("http://fake-discord.test/guilds/1");
    expect(fake.sent[0]?.headers.get("Authorization")).toBe(
      `Bot ${env.DISCORD_BOT_TOKEN}`,
    );
  });

  it("falls back to the default when DISCORD_API_BASE is empty", async () => {
    const fake = fakeFetch(ok());
    await discordApi(
      { DISCORD_BOT_TOKEN: "t", DISCORD_API_BASE: "" },
      { fetch: fake.fetch },
    ).getGuild("1");
    expect(fake.sent[0]?.url).toBe("https://discord.com/api/v10/guilds/1");
  });
});

describe("errors", () => {
  it("maps Discord's JSON error body", async () => {
    const { api } = client([
      Response.json(
        { code: 50001, message: "Missing Access" },
        { status: 403 },
      ),
    ]);
    const error = await failure(api.createMessage("10", message));
    expect(error).toBeInstanceOf(DiscordApiError);
    expect(error).toMatchObject({
      status: 403,
      code: 50001,
      discordMessage: "Missing Access",
      method: "POST",
      route: "/channels/10/messages",
    });
    expect((error as Error).message).toBe(
      "POST /channels/10/messages failed with 403: Missing Access (code 50001)",
    );
  });

  it("keeps validation details", async () => {
    const errors = {
      name: { _errors: [{ code: "BASE_TYPE_REQUIRED", message: "Required" }] },
    };
    const { api } = client([
      Response.json(
        { code: 50035, message: "Invalid Form Body", errors },
        { status: 400 },
      ),
    ]);
    const error = await failure(
      api.startForumThread("30", { name: "", message }),
    );
    expect(error.code).toBe(50035);
    expect(error.errors).toEqual(errors);
  });

  it("maps a non-JSON body", async () => {
    const { api } = client([
      new Response("upstream connect error", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    ]);
    const error = await failure(api.getGuild("40"));
    expect(error).toBeInstanceOf(DiscordApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBeUndefined();
    expect(error.discordMessage).toBe("upstream connect error");
    expect(error.method).toBe("GET");
    expect(error.route).toBe("/guilds/40");
  });

  it("maps an empty body to the status text", async () => {
    const { api } = client([
      new Response(null, { status: 500, statusText: "Internal Server Error" }),
    ]);
    const error = await failure(api.getGuild("40"));
    expect(error.discordMessage).toBe("Internal Server Error");
  });

  it("keeps the interaction token out of the route", async () => {
    const { api } = client([
      Response.json(
        { code: 10015, message: "Unknown Webhook" },
        { status: 404 },
      ),
      Response.json(
        { code: 10015, message: "Unknown Webhook" },
        { status: 404 },
      ),
    ]);
    const edit = await failure(
      api.editOriginalInteractionResponse("50", "secret-token", message),
    );
    const followup = await failure(
      api.createFollowup("50", "secret-token", message),
    );
    expect(edit.route).toBe("/webhooks/50/:token/messages/@original");
    expect(followup.route).toBe("/webhooks/50/:token");
    expect(edit.message).not.toContain("secret-token");
    expect(followup.message).not.toContain("secret-token");
  });
});

describe("rate limits", () => {
  it("waits retry_after and retries a 429", async () => {
    const { api, sent, sleeps } = client([rateLimited(0.25), ok({ id: "2" })]);
    expect(await api.createMessage("10", message)).toEqual({ id: "2" });
    expect(sleeps).toEqual([250]);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body).toEqual(sent[0]?.body);
  });

  it("uses the Retry-After header when the body has no retry_after", async () => {
    const { api, sleeps } = client([
      new Response("slow down", {
        status: 429,
        headers: { "Retry-After": "1" },
      }),
      ok(),
    ]);
    await api.getGuild("1");
    expect(sleeps).toEqual([1000]);
  });

  it("throws after too many retries", async () => {
    const { api, sent, sleeps } = client(
      [rateLimited(0.1), rateLimited(0.1), rateLimited(0.1), ok()],
      { maxRetries: 2 },
    );
    const error = await failure(api.getGuild("1"));
    expect(error).toBeInstanceOf(DiscordApiError);
    expect(error.status).toBe(429);
    expect(error.discordMessage).toBe("You are being rate limited.");
    expect(sleeps).toEqual([100, 100]);
    expect(sent).toHaveLength(3);
  });

  it("throws instead of waiting past the total wait bound", async () => {
    const { api, sent, sleeps } = client(
      [rateLimited(2), rateLimited(2), rateLimited(2), ok()],
      { maxRetries: 5, maxRetryWaitMs: 5_000 },
    );
    const error = await failure(api.getGuild("1"));
    expect(error.status).toBe(429);
    expect(sleeps).toEqual([2000, 2000]);
    expect(sent).toHaveLength(3);
  });

  it("bounds retries and waiting by default", async () => {
    const { api, sleeps } = client(
      Array.from({ length: 10 }, () => rateLimited(0.5)),
    );
    await expect(api.getGuild("1")).rejects.toBeInstanceOf(DiscordApiError);
    expect(sleeps.length).toBeLessThanOrEqual(3);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(5_000);
  });
});

describe("allowed_mentions", () => {
  const calls: [
    string,
    (api: DiscordApi, body: typeof message) => Promise<unknown>,
  ][] = [
    ["createMessage", (api, body) => api.createMessage("10", body)],
    ["editMessage", (api, body) => api.editMessage("10", "20", body)],
    [
      "startForumThread",
      (api, body) =>
        api.startForumThread("30", { name: "Hike", message: body }),
    ],
    [
      "editOriginalInteractionResponse",
      (api, body) => api.editOriginalInteractionResponse("50", "tok", body),
    ],
    ["createFollowup", (api, body) => api.createFollowup("50", "tok", body)],
  ];

  const sentMessage = (body: unknown) =>
    (body as { message?: unknown }).message ?? body;

  for (const [name, call] of calls) {
    it(`${name} defaults to no pings`, async () => {
      const { api, sent } = client([ok()]);
      await call(api, message);
      expect(sentMessage(sent[0]?.body)).toEqual({
        ...message,
        allowed_mentions: { parse: [] },
      });
    });

    it(`${name} keeps the caller's allowed_mentions`, async () => {
      const { api, sent } = client([ok()]);
      await call(api, {
        ...message,
        allowed_mentions: { parse: [], replied_user: false },
      });
      expect(sentMessage(sent[0]?.body)).toEqual({
        ...message,
        allowed_mentions: { parse: [], replied_user: false },
      });
    });
  }

  it("does not change the caller's object", async () => {
    const { api } = client([ok()]);
    const body = { ...message };
    await api.createMessage("10", body);
    expect(body).not.toHaveProperty("allowed_mentions");
  });
});

describe("eventUrl", () => {
  it("links a guild's scheduled event", () => {
    expect(eventUrl("40", "60")).toBe("https://discord.com/events/40/60");
  });
});
