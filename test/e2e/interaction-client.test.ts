/**
 * Self-tests of the interaction client against a stand-in for the Worker: a
 * local HTTP server that records what it receives and answers as each test
 * says. They check the payloads and signatures the client sends, and that it
 * fails a test when the answer is late, not 200 or invalid for the
 * interaction.
 */
import { createPublicKey, verify } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  ChannelType,
  ComponentType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
} from "discord-api-types/v10";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDiscord } from "./harness/fake-discord";
import {
  createSigner,
  InteractionClient,
  RESPONSE_DEADLINE_MS,
  stringOption,
  subcommand,
  type Actor,
  type SourceMessage,
} from "./harness/interactions";

const APPLICATION_ID = "100000000000000008";
const actor: Actor = {
  guildId: "230000000000000001",
  channelId: "330000000000000001",
  userId: "430000000000000001",
  roles: ["530000000000000001"],
};
const message: SourceMessage = {
  id: "630000000000000001",
  channel_id: actor.channelId,
  flags: MessageFlags.IsComponentsV2,
  components: [],
};

interface Received {
  headers: IncomingMessage["headers"];
  body: string;
}

const signer = createSigner();
const received: Received[] = [];
let answer: (res: ServerResponse) => void;
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    received.push({
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    answer(res);
  });
});
let client: InteractionClient;

function json(body: unknown, status = 200): (res: ServerResponse) => void {
  return (res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
}

const ok = json({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [{ type: ComponentType.TextDisplay, content: "Saved" }],
  },
});

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  client = new InteractionClient({
    url: new URL(`http://127.0.0.1:${String(port)}/`),
    signer,
    discord: new FakeDiscord({
      botToken: "unused",
      applicationId: APPLICATION_ID,
    }),
    applicationId: APPLICATION_ID,
  });
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received.length = 0;
  answer = ok;
});

/** The last interaction the stand-in received, after checking its signature. */
function lastInteraction(): Record<string, unknown> {
  const request = received.at(-1);
  if (!request) throw new Error("the stand-in received nothing");
  const publicKey = createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(signer.publicKeyHex, "hex").toString("base64url"),
    },
    format: "jwk",
  });
  const timestamp = String(request.headers["x-signature-timestamp"]);
  const signature = Buffer.from(
    String(request.headers["x-signature-ed25519"]),
    "hex",
  );
  expect(
    verify(null, Buffer.from(timestamp + request.body), publicKey, signature),
  ).toBe(true);
  return JSON.parse(request.body) as Record<string, unknown>;
}

describe("payloads", () => {
  const fromMember = {
    guild_id: actor.guildId,
    channel_id: actor.channelId,
    application_id: APPLICATION_ID,
    member: { user: { id: actor.userId }, roles: actor.roles },
    id: expect.stringMatching(/^\d+$/) as unknown,
    token: expect.any(String) as unknown,
  };

  it("sends a signed slash command with its options", async () => {
    await client.send(
      client.command(actor, "hike", [
        subcommand("start", [stringOption("location", "Ridge")]),
      ]),
    );
    expect(lastInteraction()).toMatchObject({
      ...fromMember,
      type: InteractionType.ApplicationCommand,
      data: {
        name: "hike",
        options: [
          { name: "start", options: [{ name: "location", value: "Ridge" }] },
        ],
      },
    });
  });

  it("sends a button click with the message it sits on", async () => {
    await client.send(client.button(actor, "hb:poll:vote:1", message));
    expect(lastInteraction()).toMatchObject({
      ...fromMember,
      type: InteractionType.MessageComponent,
      data: {
        custom_id: "hb:poll:vote:1",
        component_type: ComponentType.Button,
      },
      message: { id: message.id, flags: MessageFlags.IsComponentsV2 },
    });
  });

  it("sends string, role and channel selects", async () => {
    await client.send(
      client.stringSelect(actor, "hb:poll:pick", ["1", "2"], message),
    );
    expect(lastInteraction()).toMatchObject({
      data: {
        component_type: ComponentType.StringSelect,
        values: ["1", "2"],
      },
    });
    await client.send(
      client.roleSelect(
        actor,
        "hb:admin:role",
        ["530000000000000002"],
        message,
      ),
    );
    expect(lastInteraction()).toMatchObject({
      data: {
        component_type: ComponentType.RoleSelect,
        values: ["530000000000000002"],
        resolved: {
          roles: { "530000000000000002": { id: "530000000000000002" } },
        },
      },
    });
    await client.send(
      client.channelSelect(
        actor,
        "hb:admin:forum",
        [{ id: "330000000000000002", type: ChannelType.GuildForum }],
        message,
      ),
    );
    expect(lastInteraction()).toMatchObject({
      data: {
        component_type: ComponentType.ChannelSelect,
        values: ["330000000000000002"],
        resolved: {
          channels: {
            "330000000000000002": { type: ChannelType.GuildForum },
          },
        },
      },
    });
  });

  it("sends a modal submit with each value inside a Label", async () => {
    await client.send(
      client.modalSubmit(actor, "hb:location:propose", {
        "hb:location:name": "Ridge",
        "hb:location:kind": ["day-hike"],
      }),
    );
    expect(lastInteraction()).toMatchObject({
      ...fromMember,
      type: InteractionType.ModalSubmit,
      data: {
        custom_id: "hb:location:propose",
        components: [
          {
            type: ComponentType.Label,
            component: {
              type: ComponentType.TextInput,
              custom_id: "hb:location:name",
              value: "Ridge",
            },
          },
          {
            type: ComponentType.Label,
            component: {
              type: ComponentType.StringSelect,
              custom_id: "hb:location:kind",
              values: ["day-hike"],
            },
          },
        ],
      },
    });
  });

  it("sends a command from a DM without guild or member", async () => {
    await client.send(
      client.command({ channelId: "330000000000000009", userId: "1" }, "hike"),
    );
    const sent = lastInteraction();
    expect(sent).not.toHaveProperty("guild_id");
    expect(sent).not.toHaveProperty("member");
    expect(sent).toMatchObject({ user: { id: "1" } });
  });
});

describe("answers the client refuses", () => {
  it(`fails when the Worker has not answered after ${String(RESPONSE_DEADLINE_MS)} ms`, async () => {
    answer = () => {
      // Never answers; the client's deadline ends the request.
    };
    await expect(client.send(client.command(actor, "hike"))).rejects.toThrow(
      /did not answer .* within 3000 ms/,
    );
  });

  it("fails on a status other than 200", async () => {
    answer = json({ message: "nope" }, 500);
    await expect(client.send(client.command(actor, "hike"))).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it("fails on a modal in reply to a modal submit", async () => {
    answer = json({
      type: InteractionResponseType.Modal,
      data: {
        custom_id: "hb:location:again",
        title: "Again",
        components: [
          {
            type: ComponentType.Label,
            label: "Name",
            component: {
              type: ComponentType.TextInput,
              style: 1,
              custom_id: "hb:location:name",
            },
          },
        ],
      },
    });
    await expect(
      client.send(client.modalSubmit(actor, "hb:location:propose", {})),
    ).rejects.toThrow(/interaction-response-type/);
  });

  it("fails on a message response Discord would refuse", async () => {
    answer = json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { flags: MessageFlags.IsComponentsV2, content: "Saved" },
    });
    await expect(client.send(client.command(actor, "hike"))).rejects.toThrow(
      /components-v2-no-content-or-embeds/,
    );
  });
});
