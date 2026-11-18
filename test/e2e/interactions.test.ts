import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
} from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import { Member, messageText } from "./harness/helpers";
import { createSigner, type Actor } from "./harness/interactions";
import { useE2E } from "./harness/worker";

const e2e = useE2E();

const UNAVAILABLE = "This action is no longer available.";
const GUILD_ONLY =
  "hikebot only works in servers. Use it from a server it has been added to.";

const actor: Actor = {
  guildId: "200000000000000001",
  channelId: "300000000000000001",
  userId: "400000000000000001",
  roles: ["500000000000000001"],
};

/** A message the bot posted before a deploy removed its handlers. */
function oldMessage(): ReturnType<typeof e2e.discord.seedMessage> {
  return e2e.discord.seedMessage(actor.channelId, {
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: ComponentType.Container,
        components: [
          { type: ComponentType.TextDisplay, content: "Old poll" },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                style: ButtonStyle.Primary,
                label: "Vote",
                custom_id: "hb:retired:vote:1",
              },
            ],
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.StringSelect,
                custom_id: "hb:retired:pick:1",
                options: [
                  { label: "Ridge", value: "1" },
                  { label: "Lake", value: "2" },
                ],
              },
            ],
          },
          {
            type: ComponentType.ActionRow,
            components: [
              { type: ComponentType.RoleSelect, custom_id: "hb:retired:role" },
            ],
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.ChannelSelect,
                custom_id: "hb:retired:channel",
              },
            ],
          },
        ],
      },
    ],
  });
}

function expectUnavailable(response: unknown): void {
  expect(response).toMatchObject({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    },
  });
  expect(messageText((response as { data: { components: unknown[] } }).data)).toBe(
    UNAVAILABLE,
  );
}

describe("request signatures", () => {
  it("answers a signed PING with PONG", async () => {
    const response = await e2e.client.send(e2e.client.ping());
    expect(response).toEqual({ type: InteractionResponseType.Pong });
  });

  it("refuses a request without signature headers", async () => {
    const body = JSON.stringify(e2e.client.ping());
    const response = await e2e.client.post(body, {});
    expect(response.status).toBe(401);
  });

  it("refuses a request signed with another key", async () => {
    const body = JSON.stringify(e2e.client.ping());
    const other = await createSigner();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await e2e.client.post(body, {
      "X-Signature-Ed25519": await other.sign(timestamp, body),
      "X-Signature-Timestamp": timestamp,
    });
    expect(response.status).toBe(401);
  });

  it("refuses a body changed after signing", async () => {
    const signed = JSON.stringify(e2e.client.command(actor, "hike"));
    const headers = await e2e.client.signatureHeaders(signed);
    const tampered = signed.replace(actor.userId, "400000000000000999");
    const response = await e2e.client.post(tampered, headers);
    expect(response.status).toBe(401);
  });

  it("refuses a signature replayed with another timestamp", async () => {
    const body = JSON.stringify(e2e.client.ping());
    const headers = await e2e.client.signatureHeaders(body);
    const response = await e2e.client.post(body, {
      ...headers,
      "X-Signature-Timestamp": String(
        Number(headers["X-Signature-Timestamp"]) - 60,
      ),
    });
    expect(response.status).toBe(401);
  });
});

describe("interactions the bot no longer handles", () => {
  it("answers an unknown command with the ephemeral no-longer-available reply", async () => {
    const member = new Member(e2e.client, actor);
    expectUnavailable(await member.run("retired-command"));
  });

  it("answers a click on a retired button", async () => {
    const member = new Member(e2e.client, actor);
    expectUnavailable(await member.click(oldMessage(), "hb:retired:vote:1"));
  });

  it("answers a string, role and channel select on a retired message", async () => {
    e2e.discord.addChannel({
      id: "300000000000000002",
      guildId: actor.guildId ?? "",
      type: ChannelType.GuildForum,
    });
    const member = new Member(e2e.client, actor);
    const message = oldMessage();
    expectUnavailable(await member.select(message, "hb:retired:pick:1", ["2"]));
    expectUnavailable(
      await member.select(message, "hb:retired:role", ["500000000000000001"]),
    );
    expectUnavailable(
      await member.select(message, "hb:retired:channel", ["300000000000000002"]),
    );
  });

  it("answers a submit of a retired modal", async () => {
    const response = await e2e.client.send(
      e2e.client.modalSubmit(actor, "hb:retired:propose", {
        "hb:retired:name": "Ridge",
        "hb:retired:kind": ["day-hike"],
      }),
    );
    expectUnavailable(response);
  });

  it("leaves the old message as it was", async () => {
    const member = new Member(e2e.client, actor);
    const message = oldMessage();
    await member.click(message, "hb:retired:vote:1");
    expect(e2e.discord.message(message.id)).toMatchObject({ edits: 0 });
    expect(messageText(message)).toBe("Old poll");
  });
});

describe("interactions outside a server", () => {
  it("answers a command from a DM with the servers-only reply", async () => {
    const response = await e2e.client.send(
      e2e.client.command(
        { channelId: "300000000000000009", userId: actor.userId },
        "hike",
      ),
    );
    expect(response).toMatchObject({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral },
    });
    expect(
      messageText((response as { data: { components: unknown[] } }).data),
    ).toBe(GUILD_ONLY);
  });
});
