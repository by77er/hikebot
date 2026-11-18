/**
 * Self-tests of the fake Discord API: each of Discord's rules it enforces
 * accepts a payload at the limit and refuses one past it with a 400 naming
 * the rule, the same rules hold for interaction responses, and the routes,
 * failures and rate limits tests configure behave as Discord's do. No Worker
 * runs here; the tests call the fake over HTTP as the bot does.
 */
import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
} from "discord-api-types/v10";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeDiscord } from "./harness/fake-discord";
import { messageText } from "./harness/helpers";
import {
  RULES,
  validateInteractionResponse,
  type AnsweredInteraction,
  type Rule,
} from "./harness/validate";

const BOT_TOKEN = "fake-discord-test-token";
const APPLICATION_ID = "100000000000000009";
const GUILD = "220000000000000001";
const TEXT_CHANNEL = "320000000000000101";
const FORUM_CHANNEL = "320000000000000102";

let discord: FakeDiscord;

beforeAll(async () => {
  discord = new FakeDiscord({
    botToken: BOT_TOKEN,
    applicationId: APPLICATION_ID,
  });
  await discord.listen();
  discord.addGuild({ id: GUILD, ownerId: "420000000000000001" });
  discord.addChannel({ id: TEXT_CHANNEL, guildId: GUILD });
  discord.addChannel({
    id: FORUM_CHANNEL,
    guildId: GUILD,
    type: ChannelType.GuildForum,
  });
});

afterAll(async () => {
  await discord.close();
});

/** Rule ids a test has seen refused, to check that every rule is tested. */
const refused = new Set<string>();

interface Reply {
  status: number;
  body: unknown;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  /** `null` sends no Authorization header. */
  authorization: string | null = `Bot ${BOT_TOKEN}`,
): Promise<Reply> {
  const response = await fetch(`${discord.apiBase}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authorization === null ? {} : { Authorization: authorization }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? undefined : (JSON.parse(text) as unknown),
  };
}

function expectRefused(reply: Reply, rule: Rule): void {
  expect(reply.status).toBe(400);
  expect(reply.body).toMatchObject({
    code: 50035,
    message: expect.stringContaining(rule.id) as unknown,
    errors: expect.arrayContaining([
      expect.objectContaining({ rule: rule.id, docs: rule.docs }),
    ]) as unknown,
  });
  refused.add(rule.id);
  discord.takeRejections();
}

const x = (length: number): string => "x".repeat(length);
const text = (content: string) => ({
  type: ComponentType.TextDisplay,
  content,
});
const v2 = (...components: object[]) => ({
  flags: MessageFlags.IsComponentsV2,
  components,
});
const row = (...components: object[]) => ({
  type: ComponentType.ActionRow,
  components,
});
const button = (customId: string, label = "Go") => ({
  type: ComponentType.Button,
  style: ButtonStyle.Primary,
  label,
  custom_id: customId,
});
const select = (options: number, extra: object = {}) => ({
  type: ComponentType.StringSelect,
  custom_id: "hb:test:pick",
  options: Array.from({ length: options }, (_, i) => ({
    label: `Option ${String(i)}`,
    value: String(i),
  })),
  ...extra,
});
const option = (extra: object) =>
  select(1, { options: [{ label: "Ridge", value: "ridge", ...extra }] });

describe("Create Message refuses what Discord refuses", () => {
  const cases: [string, Rule, object, object][] = [
    [
      "content in a Components V2 message",
      RULES.v2NoContentOrEmbeds,
      v2(text("hi")),
      { ...v2(text("hi")), content: "hi" },
    ],
    [
      "embeds in a Components V2 message",
      RULES.v2NoContentOrEmbeds,
      v2(text("hi")),
      { ...v2(text("hi")), embeds: [{ title: "hi" }] },
    ],
    [
      "a Text Display without the Components V2 flag",
      RULES.v2FlagRequired,
      v2(text("hi")),
      { components: [text("hi")] },
    ],
    [
      "more than 40 components",
      RULES.maxComponents,
      v2(...Array.from({ length: 40 }, () => text("a"))),
      v2(...Array.from({ length: 41 }, () => text("a"))),
    ],
    [
      "more than 40 components counting nested ones",
      RULES.maxComponents,
      v2({
        type: ComponentType.Container,
        components: Array.from({ length: 39 }, () => text("a")),
      }),
      v2({
        type: ComponentType.Container,
        components: Array.from({ length: 40 }, () => text("a")),
      }),
    ],
    [
      "more than 4000 characters of text",
      RULES.maxText,
      v2(text(x(2000)), text(x(2000))),
      v2(text(x(2000)), text(x(2001))),
    ],
    [
      "content over 2000 characters without Components V2",
      RULES.maxContent,
      { content: x(2000) },
      { content: x(2001) },
    ],
    [
      "more than 5 buttons in an action row",
      RULES.actionRow,
      v2(row(...[1, 2, 3, 4, 5].map((i) => button(`hb:test:b${String(i)}`)))),
      v2(
        row(...[1, 2, 3, 4, 5, 6].map((i) => button(`hb:test:b${String(i)}`))),
      ),
    ],
    [
      "a select next to a button in an action row",
      RULES.actionRow,
      v2(row(select(2)), row(button("hb:test:go"))),
      v2(row(select(2), button("hb:test:go"))),
    ],
    [
      "a section with more than 3 Text Displays",
      RULES.section,
      v2({
        type: ComponentType.Section,
        components: [text("a"), text("b"), text("c")],
        accessory: button("hb:test:go"),
      }),
      v2({
        type: ComponentType.Section,
        components: [text("a"), text("b"), text("c"), text("d")],
        accessory: button("hb:test:go"),
      }),
    ],
    [
      "a select with more than 25 options",
      RULES.selectOptions,
      v2(row(select(25))),
      v2(row(select(26))),
    ],
    [
      "a select with no options",
      RULES.selectOptions,
      v2(row(select(1))),
      v2(row(select(0))),
    ],
    [
      "min_values over 25",
      RULES.selectValues,
      v2(row(select(25, { min_values: 25, max_values: 25 }))),
      v2(row(select(25, { min_values: 26, max_values: 25 }))),
    ],
    [
      "min_values below 0",
      RULES.selectValues,
      v2(row(select(3, { min_values: 0 }))),
      v2(row(select(3, { min_values: -1 }))),
    ],
    [
      "max_values below 1",
      RULES.selectValues,
      v2(row(select(3, { max_values: 1 }))),
      v2(row(select(3, { max_values: 0 }))),
    ],
    [
      "min_values above max_values",
      RULES.selectValues,
      v2(row(select(3, { min_values: 2, max_values: 2 }))),
      v2(row(select(3, { min_values: 3, max_values: 2 }))),
    ],
    [
      "max_values above the number of options",
      RULES.selectValues,
      v2(row(select(3, { max_values: 3 }))),
      v2(row(select(3, { max_values: 4 }))),
    ],
    [
      "a select placeholder over 150 characters",
      RULES.selectPlaceholder,
      v2(row(select(2, { placeholder: x(150) }))),
      v2(row(select(2, { placeholder: x(151) }))),
    ],
    [
      "an option label over 100 characters",
      RULES.selectOptionText,
      v2(row(option({ label: x(100) }))),
      v2(row(option({ label: x(101) }))),
    ],
    [
      "an option value over 100 characters",
      RULES.selectOptionText,
      v2(row(option({ value: x(100) }))),
      v2(row(option({ value: x(101) }))),
    ],
    [
      "an option description over 100 characters",
      RULES.selectOptionText,
      v2(row(option({ description: x(100) }))),
      v2(row(option({ description: x(101) }))),
    ],
    [
      "a button label over 80 characters",
      RULES.buttonLabel,
      v2(row(button("hb:test:go", x(80)))),
      v2(row(button("hb:test:go", x(81)))),
    ],
    [
      "a link button with a custom_id",
      RULES.buttonTarget,
      v2(
        row({
          type: ComponentType.Button,
          style: ButtonStyle.Link,
          label: "Map",
          url: "https://example.com/map",
        }),
      ),
      v2(
        row({
          type: ComponentType.Button,
          style: ButtonStyle.Link,
          label: "Map",
          url: "https://example.com/map",
          custom_id: "hb:test:map",
        }),
      ),
    ],
    [
      "a custom_id over 100 characters",
      RULES.customIdLength,
      v2(row(button(`hb:test:${x(92)}`))),
      v2(row(button(`hb:test:${x(93)}`))),
    ],
    [
      "a custom_id used twice in one message",
      RULES.customIdUnique,
      v2(
        { type: ComponentType.Container, components: [row(button("hb:a:b"))] },
        row(button("hb:a:c")),
      ),
      v2(
        { type: ComponentType.Container, components: [row(button("hb:a:b"))] },
        row(button("hb:a:b")),
      ),
    ],
  ];

  it.each(cases)("refuses %s", async (_name, rule, valid, invalid) => {
    const path = `/channels/${TEXT_CHANNEL}/messages`;
    expect(await call("POST", path, valid)).toMatchObject({ status: 200 });
    expectRefused(await call("POST", path, invalid), rule);
  });
});

describe("edits, follow-ups and threads are checked too", () => {
  it("refuses an edit that drops the Components V2 flag", async () => {
    const created = await call(
      "POST",
      `/channels/${TEXT_CHANNEL}/messages`,
      v2(text("Poll")),
    );
    const { id } = created.body as { id: string };
    const path = `/channels/${TEXT_CHANNEL}/messages/${id}`;
    expect(await call("PATCH", path, v2(text("Closed")))).toMatchObject({
      status: 200,
    });
    expect(messageText(discord.message(id) ?? {})).toBe("Closed");
    expectRefused(
      await call("PATCH", path, { flags: 0, components: [] }),
      RULES.v2FlagPermanent,
    );
    expectRefused(
      await call("PATCH", path, { content: "Closed" }),
      RULES.v2NoContentOrEmbeds,
    );
  });

  it("checks webhook edits and follow-ups, which need no bot token", async () => {
    const token = "fake-test-interaction-token";
    discord.recordInteractionResponse(
      { token, guild_id: GUILD, channel_id: TEXT_CHANNEL },
      {
        type: InteractionResponseType.DeferredChannelMessageWithSource,
        data: { flags: MessageFlags.Ephemeral },
      },
    );
    const original = `/webhooks/${APPLICATION_ID}/${token}/messages/@original`;
    expect(await call("PATCH", original, v2(text("Done")), null)).toMatchObject(
      { status: 200 },
    );
    expect(messageText(discord.originalResponse(token) ?? {})).toBe("Done");
    expectRefused(
      await call("PATCH", original, { content: "Done" }, null),
      RULES.v2NoContentOrEmbeds,
    );
    const followUp = `/webhooks/${APPLICATION_ID}/${token}?wait=true`;
    expect(await call("POST", followUp, v2(text("More")), null)).toMatchObject({
      status: 200,
    });
    expect(discord.followUps(token).map(messageText)).toEqual(["More"]);
    expectRefused(
      await call("POST", followUp, v2(row(button("hb:a:b", x(81)))), null),
      RULES.buttonLabel,
    );
  });

  it("edits the component's message as the original response after a deferred update", async () => {
    const created = await call(
      "POST",
      `/channels/${TEXT_CHANNEL}/messages`,
      v2(text("Panel")),
    );
    const { id } = created.body as { id: string };
    const token = "fake-test-deferred-update-token";
    discord.recordInteractionResponse(
      { token, guild_id: GUILD, channel_id: TEXT_CHANNEL, message: { id } },
      { type: InteractionResponseType.DeferredMessageUpdate },
    );
    const original = `/webhooks/${APPLICATION_ID}/${token}/messages/@original`;
    expect(
      await call("PATCH", original, v2(text("Updated")), null),
    ).toMatchObject({ status: 200 });
    expect(messageText(discord.message(id) ?? {})).toBe("Updated");
    expect(discord.originalResponse(token)?.id).toBe(id);
  });

  it("holds webhook requests for an interaction until its response is recorded", async () => {
    const token = "fake-test-sending-token";
    discord.sendingInteraction(token);
    const original = `/webhooks/${APPLICATION_ID}/${token}/messages/@original`;
    const edit = call("PATCH", original, v2(text("Done")), null);
    await vi.waitFor(() => {
      expect(discord.heldRequests).toBe(1);
    });
    discord.recordInteractionResponse(
      { token, guild_id: GUILD, channel_id: TEXT_CHANNEL },
      {
        type: InteractionResponseType.DeferredChannelMessageWithSource,
        data: { flags: MessageFlags.Ephemeral },
      },
    );
    expect(await edit).toMatchObject({ status: 200 });
    expect(messageText(discord.originalResponse(token) ?? {})).toBe("Done");
    expect(discord.heldRequests).toBe(0);
  });

  it("answers held webhook requests with Unknown Webhook when the interaction failed", async () => {
    const token = "fake-test-failed-token";
    discord.sendingInteraction(token);
    const followUp = `/webhooks/${APPLICATION_ID}/${token}?wait=true`;
    const post = call("POST", followUp, v2(text("More")), null);
    await vi.waitFor(() => {
      expect(discord.heldRequests).toBe(1);
    });
    discord.sentInteraction(token);
    expect(await post).toMatchObject({ status: 404, body: { code: 10015 } });
  });

  it("refuses a thread name over 100 characters", async () => {
    const path = `/channels/${FORUM_CHANNEL}/threads`;
    const created = await call("POST", path, {
      name: x(100),
      message: v2(text("Hike details")),
    });
    expect(created.status).toBe(201);
    const { id } = created.body as { id: string };
    expect(discord.threads(FORUM_CHANNEL).map((t) => t.id)).toEqual([id]);
    expect(discord.channelMessages(id).map(messageText)).toEqual([
      "Hike details",
    ]);
    expectRefused(
      await call("POST", path, {
        name: x(101),
        message: v2(text("Hike details")),
      }),
      RULES.threadName,
    );
  });

  it("refuses a forum thread in a channel that is not a forum", async () => {
    expectRefused(
      await call("POST", `/channels/${TEXT_CHANNEL}/threads`, {
        name: "Ridge hike",
        message: v2(text("Hike details")),
      }),
      RULES.forumOnly,
    );
  });

  it("refuses commands Discord would not register", async () => {
    const path = `/applications/${APPLICATION_ID}/commands`;
    const hike = { name: "hike", description: x(100), type: 1 };
    expect(await call("PUT", path, [hike])).toMatchObject({ status: 200 });
    expect(discord.commands).toMatchObject([{ name: "hike" }]);
    expectRefused(
      await call("PUT", path, [{ ...hike, name: "Hike" }]),
      RULES.commandName,
    );
    expectRefused(
      await call("PUT", path, [{ ...hike, description: x(101) }]),
      RULES.commandDescription,
    );
  });
});

describe("interaction responses are checked like messages", () => {
  const command: AnsweredInteraction = {
    type: InteractionType.ApplicationCommand,
  };
  const modalSubmit: AnsweredInteraction = {
    type: InteractionType.ModalSubmit,
  };
  const field = (labelText: string, customId = "hb:test:name") => ({
    type: ComponentType.Label,
    label: labelText,
    component: {
      type: ComponentType.TextInput,
      style: 1,
      custom_id: customId,
    },
  });
  const modal = (title: string, components: object[]) => ({
    type: InteractionResponseType.Modal,
    data: { custom_id: "hb:test:propose", title, components },
  });
  const ids = (response: unknown, interaction = command): string[] =>
    validateInteractionResponse(interaction, response).map((v) => v.rule.id);
  const refuses = (rule: Rule, response: unknown, interaction = command) => {
    expect(ids(response, interaction)).toContain(rule.id);
    refused.add(rule.id);
  };

  it("refuses a modal title over 45 characters", () => {
    expect(ids(modal(x(45), [field("Name")]))).toEqual([]);
    refuses(RULES.modalTitle, modal(x(46), [field("Name")]));
  });

  it("refuses Label text over 45 characters", () => {
    expect(ids(modal("Propose", [field(x(45))]))).toEqual([]);
    refuses(RULES.labelText, modal("Propose", [field(x(46))]));
  });

  it("refuses a modal with more than 5 components", () => {
    const fields = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        field(`Field ${String(i)}`, `hb:test:f${String(i)}`),
      );
    expect(ids(modal("Propose", fields(5)))).toEqual([]);
    refuses(RULES.modalComponents, modal("Propose", fields(6)));
  });

  it("refuses a text input whose max_length is over 4000", () => {
    const input = (maxLength: number) => ({
      ...field("Details"),
      component: { ...field("Details").component, max_length: maxLength },
    });
    expect(ids(modal("Propose", [input(4000)]))).toEqual([]);
    refuses(RULES.textInput, modal("Propose", [input(4001)]));
  });

  it("refuses a modal in reply to a modal submit", () => {
    refuses(RULES.responseType, modal("Again", [field("Name")]), modalSubmit);
  });

  it("refuses an update in reply to a modal not opened from a message", () => {
    const update = {
      type: InteractionResponseType.UpdateMessage,
      data: v2(text("Saved")),
    };
    expect(
      ids(update, {
        ...modalSubmit,
        message: { flags: MessageFlags.IsComponentsV2 },
      }),
    ).toEqual([]);
    refuses(RULES.responseType, update, modalSubmit);
  });

  it("refuses a deferred reply with any flag but ephemeral", () => {
    const deferred = (flags: number) => ({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags },
    });
    expect(ids(deferred(MessageFlags.Ephemeral))).toEqual([]);
    refuses(
      RULES.responseFlags,
      deferred(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2),
    );
  });

  it("applies the message rules to a message response", () => {
    const reply = (data: object) => ({
      type: InteractionResponseType.ChannelMessageWithSource,
      data,
    });
    expect(ids(reply(v2(text("Saved"))))).toEqual([]);
    expect(ids(reply({ ...v2(text("Saved")), content: "Saved" }))).toEqual([
      RULES.v2NoContentOrEmbeds.id,
    ]);
  });
});

describe("authorization, failures and rate limits", () => {
  it("answers 401 to a bot route without the bot token", async () => {
    const path = `/channels/${TEXT_CHANNEL}/messages`;
    for (const authorization of [null, BOT_TOKEN, "Bot wrong-token"]) {
      const reply = await call("POST", path, v2(text("hi")), authorization);
      expect(reply.status).toBe(401);
      expect(reply.body).toMatchObject({
        rule: expect.stringContaining("Authorization: Bot") as unknown,
      });
    }
    expect(discord.takeRejections()).toHaveLength(3);
  });

  it.each([
    ["missing-permissions", 403, 50013, "320000000000000201"],
    ["missing-access", 403, 50001, "320000000000000202"],
    ["unknown-channel", 404, 10003, "320000000000000203"],
  ] as const)(
    "answers a %s channel with Discord's status and code",
    async (failure, status, code, channelId) => {
      discord.addChannel({ id: channelId, guildId: GUILD });
      discord.failChannel(channelId, failure);
      const reply = await call(
        "POST",
        `/channels/${channelId}/messages`,
        v2(text("hi")),
      );
      expect(reply).toMatchObject({ status, body: { code } });
      discord.clearChannelFailure(channelId);
      expect(
        await call("POST", `/channels/${channelId}/messages`, v2(text("hi"))),
      ).toMatchObject({ status: 200 });
    },
  );

  it("holds posts in a channel until released, then applies its failure", async () => {
    const path = `/channels/${TEXT_CHANNEL}/messages`;
    const release = discord.holdChannelPosts(TEXT_CHANNEL);
    let answered = false;
    const reply = call("POST", path, v2(text("hi"))).then((r) => {
      answered = true;
      return r;
    });
    await vi.waitFor(() => {
      expect(discord.heldRequests).toBe(1);
    });
    expect(answered).toBe(false);
    discord.failChannel(TEXT_CHANNEL, "missing-permissions");
    release();
    expect(await reply).toMatchObject({ status: 403, body: { code: 50013 } });
    expect(discord.heldRequests).toBe(0);
    discord.clearChannelFailure(TEXT_CHANNEL);
    expect(await call("POST", path, v2(text("hi")))).toMatchObject({
      status: 200,
    });
  });

  it("answers one 429 with retry_after, then serves the request", async () => {
    const path = `/channels/${TEXT_CHANNEL}/messages`;
    discord.rateLimitOnce("POST", path, 1.5);
    expect(await call("POST", path, v2(text("hi")))).toMatchObject({
      status: 429,
      body: { retry_after: 1.5, global: false },
    });
    expect(await call("POST", path, v2(text("hi")))).toMatchObject({
      status: 200,
    });
  });

  it("serves the guild with its configured owner", async () => {
    expect(await call("GET", `/guilds/${GUILD}`)).toMatchObject({
      status: 200,
      body: { id: GUILD, owner_id: "420000000000000001" },
    });
    expect(await call("GET", "/guilds/229999999999999999")).toMatchObject({
      status: 404,
      body: { code: 10004 },
    });
  });

  it("serves a guild's members with their roles, and 404 Unknown Member for anyone else", async () => {
    const guild = "220000000000000005";
    const owner = "420000000000000001";
    const member = "420000000000000002";
    discord.addGuild({ id: guild, ownerId: owner, icon: "abc" });
    discord.addMember(guild, member, ["520000000000000001"]);
    expect(await call("GET", `/guilds/${guild}`)).toMatchObject({
      body: { icon: "abc" },
    });
    expect(
      await call("GET", `/guilds/${guild}/members/${owner}`),
    ).toMatchObject({ status: 200, body: { user: { id: owner }, roles: [] } });
    expect(
      await call("GET", `/guilds/${guild}/members/${member}`),
    ).toMatchObject({
      status: 200,
      body: { user: { id: member }, roles: ["520000000000000001"] },
    });
    discord.removeMember(guild, member);
    expect(
      await call("GET", `/guilds/${guild}/members/${member}`),
    ).toMatchObject({ status: 404, body: { code: 10007 } });
    expect(
      await call("GET", `/guilds/229999999999999999/members/${member}`),
    ).toMatchObject({ status: 404, body: { code: 10004 } });
    expect(
      await call("GET", `/guilds/${guild}/members/${owner}`, undefined, null),
    ).toMatchObject({ status: 401 });
    discord.takeRejections();
  });

  it("serves a guild's channels without its threads", async () => {
    const guild = "220000000000000006";
    discord.addGuild({ id: guild, ownerId: "420000000000000001" });
    discord.addChannel({
      id: "320000000000000601",
      guildId: guild,
      name: "votes",
    });
    discord.addChannel({
      id: "320000000000000602",
      guildId: guild,
      type: ChannelType.GuildForum,
      name: "hikes",
    });
    expect(
      await call("POST", "/channels/320000000000000602/threads", {
        name: "Ridge",
        message: v2(text("hi")),
      }),
    ).toMatchObject({ status: 201 });
    const reply = await call("GET", `/guilds/${guild}/channels`);
    expect(reply.status).toBe(200);
    expect(
      (reply.body as { id: string; name: string }[]).map((c) => [c.id, c.name]),
    ).toEqual([
      ["320000000000000601", "votes"],
      ["320000000000000602", "hikes"],
    ]);
    expect(
      await call("GET", "/guilds/229999999999999999/channels"),
    ).toMatchObject({ status: 404, body: { code: 10004 } });
  });
});

describe("scheduled events", () => {
  const EVENT_GUILD = "220000000000000002";
  const path = (guildId = EVENT_GUILD) => `/guilds/${guildId}/scheduled-events`;
  const hike = {
    name: x(100),
    privacy_level: 2,
    scheduled_start_time: "2030-06-15T16:00:00.000Z",
    scheduled_end_time: "2030-06-15T20:00:00.000Z",
    entity_type: 3,
    entity_metadata: { location: x(100) },
    description: x(1000),
  };

  /** `body` without the field `key`. */
  function without(body: object, key: string): object {
    return Object.fromEntries(
      Object.entries(body).filter(([name]) => name !== key),
    );
  }

  /** Checks a refusal Discord makes in a state, not for the payload. */
  function expectStateRefusal(
    reply: Reply,
    status: number,
    code: number,
    rule: Rule,
  ): void {
    expect(reply).toMatchObject({
      status,
      body: { code, rule: rule.id, docs: rule.docs },
    });
    refused.add(rule.id);
    expect(discord.takeRejections()).toEqual([]);
  }

  beforeAll(() => {
    discord.addGuild({ id: EVENT_GUILD, ownerId: "420000000000000001" });
  });

  it("creates an EXTERNAL event at the limits and keeps it for the guild", async () => {
    const reply = await call("POST", path(), hike);
    expect(reply.status).toBe(200);
    const { id } = reply.body as { id: string };
    expect(discord.scheduledEvents(EVENT_GUILD)).toEqual([
      {
        id,
        guild_id: EVENT_GUILD,
        channel_id: null,
        creator_id: APPLICATION_ID,
        name: hike.name,
        description: hike.description,
        scheduled_start_time: hike.scheduled_start_time,
        scheduled_end_time: hike.scheduled_end_time,
        privacy_level: 2,
        status: 1,
        entity_type: 3,
        entity_id: null,
        entity_metadata: { location: hike.entity_metadata.location },
      },
    ]);
    expect(reply.body).toMatchObject({ id, name: hike.name });
    expect(discord.takeRejections()).toEqual([]);
  });

  it("refuses an event without its required fields", async () => {
    expectRefused(
      await call("POST", path(), without(hike, "name")),
      RULES.eventName,
    );
    expectRefused(
      await call("POST", path(), { ...hike, privacy_level: 1 }),
      RULES.eventRequired,
    );
    expectRefused(
      await call("POST", path(), { ...hike, scheduled_start_time: "soon" }),
      RULES.eventRequired,
    );
    expectRefused(
      await call("POST", path(), { ...hike, entity_type: 4 }),
      RULES.eventRequired,
    );
  });

  it("refuses a name, description or location past Discord's limits", async () => {
    expectRefused(
      await call("POST", path(), { ...hike, name: x(101) }),
      RULES.eventName,
    );
    expectRefused(
      await call("POST", path(), { ...hike, name: "" }),
      RULES.eventName,
    );
    expectRefused(
      await call("POST", path(), { ...hike, description: x(1001) }),
      RULES.eventDescription,
    );
    expectRefused(
      await call("POST", path(), {
        ...hike,
        entity_metadata: { location: x(101) },
      }),
      RULES.eventLocation,
    );
  });

  it("refuses an EXTERNAL event without an end, without a location, or with a channel", async () => {
    expectRefused(
      await call("POST", path(), without(hike, "scheduled_end_time")),
      RULES.externalEventEnd,
    );
    expectRefused(
      await call("POST", path(), without(hike, "entity_metadata")),
      RULES.externalEventLocation,
    );
    expectRefused(
      await call("POST", path(), { ...hike, entity_metadata: {} }),
      RULES.externalEventLocation,
    );
    expectRefused(
      await call("POST", path(), { ...hike, channel_id: TEXT_CHANNEL }),
      RULES.externalEventChannel,
    );
  });

  it("refuses the 101st scheduled event of a guild with code 30038", async () => {
    const full = "220000000000000003";
    discord.addGuild({ id: full, ownerId: "420000000000000001" });
    discord.seedScheduledEvents(full, 99);
    expect(await call("POST", path(full), hike)).toMatchObject({
      status: 200,
    });
    expect(discord.scheduledEvents(full)).toHaveLength(100);
    expectStateRefusal(
      await call("POST", path(full), hike),
      400,
      30038,
      RULES.maxScheduledEvents,
    );
    expect(discord.scheduledEvents(full)).toHaveLength(100);
  });

  it("refuses with 403 Missing Permissions while the bot lacks Create Events", async () => {
    const guild = "220000000000000004";
    discord.addGuild({ id: guild, ownerId: "420000000000000001" });
    discord.revokeCreateEvents(guild);
    expectStateRefusal(
      await call("POST", path(guild), hike),
      403,
      50013,
      RULES.createEventsPermission,
    );
    expect(discord.scheduledEvents(guild)).toEqual([]);
    discord.grantCreateEvents(guild);
    expect(await call("POST", path(guild), hike)).toMatchObject({
      status: 200,
    });
    expect(discord.scheduledEvents(guild)).toHaveLength(1);
  });

  it("answers Unknown Guild for a guild it does not hold", async () => {
    expect(await call("POST", path("229999999999999999"), hike)).toMatchObject({
      status: 404,
      body: { code: 10004 },
    });
  });
});

describe("OAuth2 sign-in", () => {
  const CLIENT_SECRET = "fake-discord-test-secret";
  const REDIRECT = "https://hikebot.example/auth/callback";
  const USER = "420000000000000501";
  const BOT_GUILDS = ["220000000000000501", "220000000000000502"];
  const OTHER_GUILD = "220000000000000599";
  const basic = `Basic ${Buffer.from(`${APPLICATION_ID}:${CLIENT_SECRET}`).toString("base64")}`;
  let oauth: FakeDiscord;

  beforeAll(async () => {
    oauth = new FakeDiscord({
      botToken: BOT_TOKEN,
      applicationId: APPLICATION_ID,
      clientSecret: CLIENT_SECRET,
      redirectUris: [REDIRECT],
    });
    await oauth.listen();
    for (const id of BOT_GUILDS) oauth.addGuild({ id, ownerId: USER });
    oauth.addUser({
      id: USER,
      username: "ana",
      globalName: "Ana",
      guilds: [
        { id: BOT_GUILDS[0] ?? "", name: "Ridge Walkers" },
        { id: OTHER_GUILD, name: "Book Club" },
      ],
    });
  });

  afterAll(async () => {
    await oauth.close();
  });

  const authorizeQuery = (extra: Record<string, string> = {}) =>
    new URLSearchParams({
      response_type: "code",
      client_id: APPLICATION_ID,
      scope: "identify guilds",
      redirect_uri: REDIRECT,
      state: "s-1",
      prompt: "none",
      ...extra,
    });

  async function authorize(
    query: URLSearchParams,
    cookie = `fake_discord_user=${USER}`,
  ): Promise<Reply & { location: URL | null }> {
    const response = await fetch(`${oauth.authorizeUrl}?${query.toString()}`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    const text = await response.text();
    const location = response.headers.get("Location");
    return {
      status: response.status,
      body: text === "" ? undefined : (JSON.parse(text) as unknown),
      location: location === null ? null : new URL(location),
    };
  }

  async function post(
    path: string,
    form: Record<string, string>,
    headers: Record<string, string> = {
      Authorization: basic,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  ): Promise<Reply> {
    const response = await fetch(`${oauth.apiBase}${path}`, {
      method: "POST",
      headers,
      body:
        headers["Content-Type"] === "application/json"
          ? JSON.stringify(form)
          : new URLSearchParams(form).toString(),
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  }

  async function get(path: string, authorization: string): Promise<Reply> {
    const response = await fetch(`${oauth.apiBase}${path}`, {
      headers: { Authorization: authorization },
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  }

  async function code(): Promise<string> {
    const reply = await authorize(authorizeQuery());
    return reply.location?.searchParams.get("code") ?? "";
  }

  const exchange = (theCode: string, extra: Record<string, string> = {}) =>
    post("/oauth2/token", {
      grant_type: "authorization_code",
      code: theCode,
      redirect_uri: REDIRECT,
      ...extra,
    });

  function expectOAuthRefused(reply: Reply, rule: Rule, status = 400): void {
    expect(reply.status).toBe(status);
    expect(reply.body).toMatchObject({ rule: rule.id, docs: rule.docs });
    expect(JSON.stringify(reply.body)).not.toContain(CLIENT_SECRET);
    refused.add(rule.id);
    expect(oauth.takeRejections()).toHaveLength(1);
  }

  it("redirects back with a code and the state, or access_denied on Cancel", async () => {
    const approved = await authorize(authorizeQuery());
    expect(approved.status).toBe(302);
    expect(
      `${approved.location?.origin ?? ""}${approved.location?.pathname ?? ""}`,
    ).toBe(REDIRECT);
    expect(approved.location?.searchParams.get("state")).toBe("s-1");
    expect(approved.location?.searchParams.get("code")).toMatch(/^fake-code-/);

    const denied = await authorize(
      authorizeQuery(),
      `fake_discord_user=${USER}; fake_discord_consent=deny`,
    );
    expect(
      Object.fromEntries(denied.location?.searchParams ?? []),
    ).toMatchObject({ error: "access_denied", state: "s-1" });
    expect(denied.location?.searchParams.has("code")).toBe(false);
  });

  it("exchanges a code for a token that reads the user and their servers until revoked", async () => {
    const token = await exchange(await code());
    expect(token).toMatchObject({
      status: 200,
      body: { token_type: "Bearer", scope: "identify guilds" },
    });
    const access = (token.body as { access_token: string }).access_token;
    expect(await get("/users/@me", `Bearer ${access}`)).toMatchObject({
      status: 200,
      body: { id: USER, username: "ana", global_name: "Ana", avatar: null },
    });
    const guilds = await get("/users/@me/guilds", `Bearer ${access}`);
    expect((guilds.body as { id: string }[]).map((g) => g.id)).toEqual([
      BOT_GUILDS[0],
      OTHER_GUILD,
    ]);
    expect(
      await post("/oauth2/token/revoke", {
        token: access,
        token_type_hint: "access_token",
      }),
    ).toMatchObject({ status: 200 });
    expect(oauth.oauth.revoked(access)).toBe(true);
    expect((await get("/users/@me", `Bearer ${access}`)).status).toBe(401);
    expect(oauth.takeRejections()).toHaveLength(1);
  });

  it("accepts the client credentials in the form body", async () => {
    const reply = await post(
      "/oauth2/token",
      {
        grant_type: "authorization_code",
        code: await code(),
        redirect_uri: REDIRECT,
        client_id: APPLICATION_ID,
        client_secret: CLIENT_SECRET,
      },
      { "Content-Type": "application/x-www-form-urlencoded" },
    );
    expect(reply.status).toBe(200);
  });

  it("pages the bot's servers with limit and after", async () => {
    const bot = `Bot ${BOT_TOKEN}`;
    expect(await get("/users/@me", bot)).toMatchObject({
      status: 200,
      body: { id: APPLICATION_ID, bot: true },
    });
    const first = await get("/users/@me/guilds?limit=1", bot);
    expect((first.body as { id: string }[]).map((g) => g.id)).toEqual([
      BOT_GUILDS[0],
    ]);
    const second = await get(
      `/users/@me/guilds?limit=200&after=${BOT_GUILDS[0] ?? ""}`,
      bot,
    );
    expect((second.body as { id: string }[]).map((g) => g.id)).toEqual([
      BOT_GUILDS[1],
    ]);
  });

  it("refuses an authorize request for another response type", async () => {
    expectOAuthRefused(
      await authorize(authorizeQuery({ response_type: "token" })),
      RULES.oauthResponseType,
    );
  });

  it("refuses an unknown client, at the authorize page and the token URL", async () => {
    expectOAuthRefused(
      await authorize(authorizeQuery({ client_id: "100000000000000000" })),
      RULES.oauthClientCredentials,
    );
    const theCode = await code();
    expectOAuthRefused(
      await post(
        "/oauth2/token",
        {
          grant_type: "authorization_code",
          code: theCode,
          redirect_uri: REDIRECT,
        },
        {
          Authorization: `Basic ${Buffer.from(`${APPLICATION_ID}:wrong`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      ),
      RULES.oauthClientCredentials,
      401,
    );
    expect((await exchange(theCode)).status).toBe(200);
  });

  it("refuses a redirect URI the application did not register", async () => {
    const reply = await authorize(
      authorizeQuery({ redirect_uri: "https://evil.example/auth/callback" }),
    );
    expect(reply.location).toBeNull();
    expect(reply.body).toMatchObject({
      error_description: "Invalid OAuth2 redirect_uri",
    });
    expectOAuthRefused(reply, RULES.oauthRegisteredRedirectUri);
  });

  it("refuses a token request that is not a form", async () => {
    expectOAuthRefused(
      await post(
        "/oauth2/token",
        { grant_type: "authorization_code", code: await code() },
        { Authorization: basic, "Content-Type": "application/json" },
      ),
      RULES.oauthFormBody,
    );
  });

  it("refuses another grant type", async () => {
    expectOAuthRefused(
      await exchange(await code(), { grant_type: "client_credentials" }),
      RULES.oauthGrantType,
    );
  });

  it("takes a code once", async () => {
    const theCode = await code();
    expect((await exchange(theCode)).status).toBe(200);
    const again = await exchange(theCode);
    expect(again.body).toMatchObject({ error: "invalid_grant" });
    expect(JSON.stringify(again.body)).not.toContain(theCode);
    expectOAuthRefused(again, RULES.oauthCodeSingleUse);
  });

  it("refuses a redirect URI other than the authorization's", async () => {
    expectOAuthRefused(
      await exchange(await code(), {
        redirect_uri: "https://hikebot.example/other",
      }),
      RULES.oauthRedirectUriMatches,
    );
  });

  it("serves 1 to 200 servers a page", async () => {
    const bot = `Bot ${BOT_TOKEN}`;
    expect((await get("/users/@me/guilds?limit=200", bot)).status).toBe(200);
    expectOAuthRefused(
      await get("/users/@me/guilds?limit=201", bot),
      RULES.currentUserGuildsLimit,
    );
  });
});

describe("rule coverage", () => {
  it("has a test above for every rule the fake enforces", () => {
    const untested = Object.values(RULES)
      .map((rule) => rule.id)
      .filter((id) => !refused.has(id));
    expect(untested).toEqual([]);
  });
});
