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
  channelUrl,
  eventUrl,
  guildIconUrl,
  imageData,
  oauthAuthorizeUrl,
  type FileUpload,
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
      body:
        text === ""
          ? undefined
          : request.headers.get("Content-Type") === "application/json"
            ? JSON.parse(text)
            : text,
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
      name: "editGuildScheduledEvent",
      call: (api) =>
        api.editGuildScheduledEvent("40", "60", { description: "Map" }),
      method: "PATCH",
      url: `${base}/guilds/40/scheduled-events/60`,
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
      name: "getGuildMember",
      call: (api) => api.getGuildMember("40", "60"),
      method: "GET",
      url: `${base}/guilds/40/members/60`,
      auth: true,
    },
    {
      name: "getGuildChannels",
      call: (api) => api.getGuildChannels("40"),
      method: "GET",
      url: `${base}/guilds/40/channels`,
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
      name: "getBotGuilds",
      call: (api) => api.getBotGuilds({ limit: 200, after: "70" }),
      method: "GET",
      url: `${base}/users/@me/guilds?after=70&limit=200`,
      auth: true,
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

  it("getGuildMember surfaces Unknown Member as a 404 DiscordApiError", async () => {
    const { api } = client([
      Response.json(
        { message: "Unknown Member", code: 10007 },
        { status: 404 },
      ),
    ]);
    const error = await failure(api.getGuildMember("40", "60"));
    expect(error.status).toBe(404);
    expect(error.code).toBe(10007);
    expect(error.route).toBe("/guilds/40/members/60");
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

describe("file uploads", () => {
  const png: FileUpload = {
    name: "hike-map.png",
    data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
    contentType: "image/png",
  };

  /** A fetch that keeps each request's multipart form. */
  function formFetch(...responses: Response[]) {
    const forms: { request: Request; form: FormData }[] = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      forms.push({ request, form: await request.clone().formData() });
      const response = responses.shift();
      if (!response) throw new Error("unexpected request");
      return response;
    };
    return { fetch, forms };
  }

  function payload(form: FormData | null | undefined): unknown {
    const json = form?.get("payload_json");
    if (typeof json !== "string") throw new Error("no payload_json field");
    return JSON.parse(json);
  }

  async function fileBytes(form: FormData, field: string) {
    const file = form.get(field);
    if (!(file instanceof File)) throw new Error(`${field} is not a file`);
    return {
      name: file.name,
      type: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
  }

  it("posts a message with files as payload_json and files[n]", async () => {
    const { fetch, forms } = formFetch(ok({ id: "99" }));
    const api = new DiscordApi({ token: "bot-token", fetch });
    await api.createMessage("10", message, [png]);
    const { request, form } = forms[0] ?? { request: null, form: null };
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(
      "https://discord.com/api/v10/channels/10/messages",
    );
    expect(request?.headers.get("Content-Type")).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(request?.headers.get("Authorization")).toBe("Bot bot-token");
    expect([...(form?.keys() ?? [])]).toEqual(["payload_json", "files[0]"]);
    expect(payload(form)).toEqual({
      ...message,
      allowed_mentions: { parse: [] },
      attachments: [{ id: 0, filename: "hike-map.png" }],
    });
    expect(await fileBytes(form ?? new FormData(), "files[0]")).toEqual({
      name: "hike-map.png",
      type: "image/png",
      bytes: png.data,
    });
  });

  it("edits a message with files, listing only the new files and the kept ones", async () => {
    const { fetch, forms } = formFetch(ok({ id: "20" }));
    const api = new DiscordApi({ token: "bot-token", fetch });
    const other: FileUpload = { ...png, name: "second.png" };
    await api.editMessage(
      "10",
      "20",
      { ...message, attachments: [{ id: "555" }] },
      [png, other],
    );
    const { request, form } = forms[0] ?? { request: null, form: null };
    expect(request?.method).toBe("PATCH");
    expect(payload(form)).toEqual({
      ...message,
      allowed_mentions: { parse: [] },
      attachments: [
        { id: "555" },
        { id: 0, filename: "hike-map.png" },
        { id: 1, filename: "second.png" },
      ],
    });
    expect((await fileBytes(form ?? new FormData(), "files[1]")).name).toBe(
      "second.png",
    );
  });

  it("sends the same files again after a 429", async () => {
    const { fetch, forms } = formFetch(rateLimited(0.01), ok({ id: "20" }));
    const api = new DiscordApi({
      token: "bot-token",
      fetch,
      sleep: () => Promise.resolve(),
    });
    await api.editMessage("10", "20", message, [png]);
    expect(forms).toHaveLength(2);
    expect(
      (await fileBytes(forms[1]?.form ?? new FormData(), "files[0]")).bytes,
    ).toEqual(png.data);
  });

  it("edits a message as JSON, leaving its attachments alone, without files", async () => {
    const { api, sent } = client([ok({ id: "20" })]);
    await api.editMessage("10", "20", message);
    expect(sent[0]?.headers.get("Content-Type")).toBe("application/json");
    expect(sent[0]?.body).toEqual({
      ...message,
      allowed_mentions: { parse: [] },
    });
  });

  it("sends a scheduled event's cover as image data", async () => {
    const { api, sent } = client([ok({ id: "60" })]);
    await api.editGuildScheduledEvent("40", "60", {
      image: imageData(png.data, "image/png"),
    });
    expect(sent[0]?.body).toEqual({
      image: `data:image/png;base64,${btoa(String.fromCharCode(...png.data))}`,
    });
  });

  it("encodes large images whole", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    const uri = imageData(bytes, "image/png");
    const decoded = Uint8Array.from(
      atob(uri.slice("data:image/png;base64,".length)),
      (c) => c.charCodeAt(0),
    );
    expect(decoded).toEqual(bytes);
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

describe("OAuth2 routes", () => {
  const base = "https://discord.com/api/v10";
  const app = { id: "50", secret: "client-secret" };
  const basic = `Basic ${btoa("50:client-secret")}`;

  it("exchangeOAuthCode posts the code as a form with the client's Basic credentials", async () => {
    const { api, sent } = client([ok({ access_token: "at" })]);
    expect(
      await api.exchangeOAuthCode(app, "the-code", "https://x.example/cb"),
    ).toEqual({ access_token: "at" });
    expect(sent[0]).toMatchObject({
      method: "POST",
      url: `${base}/oauth2/token`,
    });
    expect(sent[0]?.headers.get("Authorization")).toBe(basic);
    expect(sent[0]?.headers.get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(sent[0]?.body).toBe(
      "grant_type=authorization_code&code=the-code&redirect_uri=https%3A%2F%2Fx.example%2Fcb",
    );
  });

  it("revokeOAuthToken posts the access token as a form", async () => {
    const { api, sent } = client([ok({})]);
    await api.revokeOAuthToken(app, "at");
    expect(sent[0]?.url).toBe(`${base}/oauth2/token/revoke`);
    expect(sent[0]?.headers.get("Authorization")).toBe(basic);
    expect(sent[0]?.body).toBe("token=at&token_type_hint=access_token");
  });

  it("getOAuthUser and getOAuthUserGuilds send the user's token, not the bot's", async () => {
    const { api, sent } = client([ok({ id: "7" }), ok([])]);
    await api.getOAuthUser("at");
    await api.getOAuthUserGuilds("at");
    expect(
      sent.map((s) => [s.method, s.url, s.headers.get("Authorization")]),
    ).toEqual([
      ["GET", `${base}/users/@me`, "Bearer at"],
      ["GET", `${base}/users/@me/guilds`, "Bearer at"],
    ]);
  });

  it("errors name the route, never the code, token or secret", async () => {
    const { api } = client([
      Response.json(
        { error: "invalid_grant", error_description: "Invalid code" },
        { status: 400 },
      ),
      Response.json({ message: "401: Unauthorized", code: 0 }, { status: 401 }),
    ]);
    const exchange = await failure(api.exchangeOAuthCode(app, "the-code", "u"));
    expect(exchange.route).toBe("/oauth2/token");
    const user = await failure(api.getOAuthUser("secret-at"));
    expect(user.route).toBe("/users/@me");
    for (const error of [exchange, user]) {
      for (const secret of ["the-code", "secret-at", "client-secret"]) {
        expect(error.message).not.toContain(secret);
      }
    }
  });
});

describe("oauthAuthorizeUrl", () => {
  const query = {
    clientId: "50",
    scope: "identify guilds",
    redirectUri: "https://x.example/auth/callback",
    state: "s1",
  };

  it("builds Discord's authorize address with prompt=none", () => {
    expect(oauthAuthorizeUrl({}, query)).toBe(
      "https://discord.com/oauth2/authorize?response_type=code&client_id=50&scope=identify+guilds&redirect_uri=https%3A%2F%2Fx.example%2Fauth%2Fcallback&state=s1&prompt=none",
    );
  });

  it("uses DISCORD_OAUTH_AUTHORIZE_URL when set", () => {
    expect(
      oauthAuthorizeUrl(
        { DISCORD_OAUTH_AUTHORIZE_URL: "http://127.0.0.1:9/oauth2/authorize" },
        query,
      ),
    ).toMatch(
      /^http:\/\/127\.0\.0\.1:9\/oauth2\/authorize\?response_type=code&/,
    );
  });
});

describe("eventUrl", () => {
  it("links a guild's scheduled event", () => {
    expect(eventUrl("40", "60")).toBe("https://discord.com/events/40/60");
  });
});

describe("channelUrl", () => {
  it("links a channel, and a message in it", () => {
    expect(channelUrl("40", "50")).toBe("https://discord.com/channels/40/50");
    expect(channelUrl("40", "50", "60")).toBe(
      "https://discord.com/channels/40/50/60",
    );
  });
});

describe("guildIconUrl", () => {
  it("links the icon on Discord's CDN", () => {
    expect(guildIconUrl("40", "abc")).toBe(
      "https://cdn.discordapp.com/icons/40/abc.png",
    );
  });
});
