/**
 * Harness self-tests that need the bot to keep state and call Discord. They
 * run the probe Worker (`test/e2e/probe/worker.ts`): the real Worker and
 * `GuildHike` with one extra `/e2e-probe` command whose follow-ups call the
 * fake through the real `DiscordApi`.
 */
import { describe, expect, it } from "vitest";
import { messageText, waitForOriginalResponse } from "./harness/helpers";
import {
  stringOption,
  subcommand,
  type Actor,
  type Interaction,
} from "./harness/interactions";
import { BOT_TOKEN, useE2E } from "./harness/worker";

const e2e = useE2E({ probe: true });

function actorIn(guild: number): Actor {
  return {
    guildId: `21000000000000000${String(guild)}`,
    channelId: `31000000000000000${String(guild)}`,
    userId: "410000000000000001",
  };
}

async function probe(
  actor: Actor,
  name: string,
  options: Record<string, string> = {},
): Promise<{ interaction: Interaction; text: string }> {
  const interaction = e2e.client.command(actor, "e2e-probe", [
    subcommand(
      name,
      Object.entries(options).map(([key, value]) => stringOption(key, value)),
    ),
  ]);
  const response = await e2e.client.send(interaction);
  const data = "data" in response ? (response.data as object) : {};
  return { interaction, text: messageText(data) };
}

/** Runs a deferred probe and waits for the follow-up to edit its reply. */
async function probeOutcome(
  actor: Actor,
  name: string,
  options: Record<string, string> = {},
): Promise<string> {
  const { interaction } = await probe(actor, name, options);
  const edited = await waitForOriginalResponse(
    e2e.discord,
    interaction.token,
    (message) => message.edits > 0,
  );
  return messageText(edited);
}

describe("guild isolation", () => {
  it("keeps each guild's state in its own Durable Object", async () => {
    const ridge = actorIn(1);
    const lake = actorIn(2);
    expect((await probe(ridge, "remember", { note: "ridge" })).text).toBe(
      "Remembered 1",
    );
    expect((await probe(lake, "remember", { note: "lake" })).text).toBe(
      "Remembered 1",
    );
    expect((await probe(ridge, "remember", { note: "summit" })).text).toBe(
      "Remembered 2",
    );
    expect((await probe(ridge, "recall")).text).toBe("Notes: ridge, summit");
    expect((await probe(lake, "recall")).text).toBe("Notes: lake");
  });
});

describe("the bot's REST client against the fake Discord API", () => {
  it("posts a message and edits the deferred reply", async () => {
    const actor = actorIn(3);
    const channelId = "320000000000000001";
    e2e.discord.addChannel({ id: channelId, guildId: actor.guildId ?? "" });
    const outcome = await probeOutcome(actor, "post", { channel: channelId });
    const [posted] = e2e.discord.channelMessages(channelId);
    expect(outcome).toBe(`Posted ${posted?.id ?? "?"}`);
    expect(messageText(posted ?? {})).toBe("Probe post");
    const create = await e2e.discord.nextRequest(
      (r) =>
        r.method === "POST" && r.path === `/channels/${channelId}/messages`,
    );
    expect(create.headers.authorization).toBe(`Bot ${BOT_TOKEN}`);
    expect(create.body).toMatchObject({ allowed_mentions: { parse: [] } });
    const edit = await e2e.discord.nextRequest(
      (r) => r.method === "PATCH" && r.route.endsWith("/messages/@original"),
    );
    expect(edit.headers.authorization).toBeUndefined();
  });

  it("retries a request Discord answered with 429 after retry_after", async () => {
    const actor = actorIn(4);
    const channelId = "320000000000000002";
    const path = `/channels/${channelId}/messages`;
    e2e.discord.addChannel({ id: channelId, guildId: actor.guildId ?? "" });
    e2e.discord.rateLimitOnce("POST", path, 0.25);
    const outcome = await probeOutcome(actor, "post", { channel: channelId });
    expect(outcome).toMatch(/^Posted \d+$/);
    const attempts = e2e.discord.requests.filter(
      (r) => r.method === "POST" && r.path === path,
    );
    expect(attempts.map((r) => r.status)).toEqual([429, 200]);
    expect(attempts[0]?.response).toMatchObject({ retry_after: 0.25 });
    expect(e2e.discord.channelMessages(channelId)).toHaveLength(1);
  });

  it.each([
    ["missing-permissions", 403, 50013, "330000000000000001"],
    ["missing-access", 403, 50001, "330000000000000002"],
    ["unknown-channel", 404, 10003, "330000000000000003"],
  ] as const)(
    "surfaces a %s failure as the REST client's error",
    async (failure, status, code, channelId) => {
      const actor = actorIn(5);
      e2e.discord.addChannel({ id: channelId, guildId: actor.guildId ?? "" });
      e2e.discord.failChannel(channelId, failure);
      const outcome = await probeOutcome(actor, "post", {
        channel: channelId,
      });
      expect(outcome).toBe(
        `Discord refused: ${String(status)} ${String(code)} on POST /channels/${channelId}/messages`,
      );
      expect(e2e.discord.channelMessages(channelId)).toEqual([]);
    },
  );

  it("treats a channel the fake does not know as deleted", async () => {
    const outcome = await probeOutcome(actorIn(6), "post", {
      channel: "339999999999999999",
    });
    expect(outcome).toBe(
      "Discord refused: 404 10003 on POST /channels/339999999999999999/messages",
    );
  });

  it("reads the guild owner the test configured", async () => {
    const actor = actorIn(7);
    e2e.discord.addGuild({
      id: actor.guildId ?? "",
      ownerId: "410000000000000777",
    });
    expect(await probeOutcome(actor, "owner")).toBe("Owner 410000000000000777");
  });
});
