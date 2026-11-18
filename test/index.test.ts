import { listDurableObjectIds } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import {
  ComponentType,
  InteractionResponseType,
  MessageFlags,
} from "discord-api-types/v10";
import { beforeAll, describe, expect, it } from "vitest";
import * as entry from "../src";
import { GUILD_ONLY_MESSAGE } from "../src/discord/responses";
import { UNAVAILABLE_MESSAGE } from "../src/guild/router";
import {
  callWorker,
  commandInteraction,
  createSigner,
  IncomingRequest,
  interactionRequest,
  signedRequest,
  TIMESTAMP,
  type Signer,
} from "./helpers";

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});

async function guildObjectIds(): Promise<string[]> {
  return (await listDurableObjectIds(env.GUILD_HIKE)).map((id) =>
    id.toString(),
  );
}

function ephemeralTextReply(text: string): unknown {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      components: [{ type: ComponentType.TextDisplay, content: text }],
      allowed_mentions: { parse: [] },
    },
  };
}

describe("entry module", () => {
  // workerd refuses to start a Worker whose main module exports anything
  // other than handlers and classes, which unit tests would not notice.
  it("exports only the fetch handler and classes", () => {
    for (const [name, value] of Object.entries(entry)) {
      if (name === "default") continue;
      expect(typeof value, `export ${name}`).toBe("function");
    }
  });
});

describe("routes", () => {
  it("serves GET / from the deployed entry module", async () => {
    const response = await exports.default.fetch("https://hikebot.example/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hikebot is running\n");
  });

  it("answers GET / with a plain-text health line", async () => {
    const response = await callWorker(
      signer,
      new IncomingRequest("https://hikebot.example/"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(await response.text()).toBe("hikebot is running\n");
  });

  it("returns 404 for unknown paths", async () => {
    const response = await callWorker(
      signer,
      new IncomingRequest("https://hikebot.example/nope"),
    );
    expect(response.status).toBe(404);
  });

  it("returns 405 for non-POST requests to /interactions", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await callWorker(
        signer,
        new IncomingRequest("https://hikebot.example/interactions", { method }),
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    }
  });
});

describe("POST /interactions signature check", () => {
  const guildId = "401401401";
  const body = JSON.stringify(commandInteraction("hike", guildId));

  async function expectRejected(headers: Record<string, string>) {
    const response = await callWorker(
      signer,
      interactionRequest(body, headers),
    );
    expect(response.status).toBe(401);
  }

  it("rejects missing headers", async () => {
    const signature = await signer.sign(TIMESTAMP, body);
    await expectRejected({});
    await expectRejected({ "X-Signature-Timestamp": TIMESTAMP });
    await expectRejected({ "X-Signature-Ed25519": signature });
  });

  it("rejects a signature from the wrong key", async () => {
    const other = await createSigner();
    await expectRejected({
      "X-Signature-Ed25519": await other.sign(TIMESTAMP, body),
      "X-Signature-Timestamp": TIMESTAMP,
    });
  });

  it("rejects a tampered body", async () => {
    const signature = await signer.sign(TIMESTAMP, body);
    const response = await callWorker(
      signer,
      interactionRequest(body.replace("hike", "hikf"), {
        "X-Signature-Ed25519": signature,
        "X-Signature-Timestamp": TIMESTAMP,
      }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects malformed hex", async () => {
    await expectRejected({
      "X-Signature-Ed25519": "not-a-hex-signature",
      "X-Signature-Timestamp": TIMESTAMP,
    });
  });

  it("never reaches the Durable Object when rejected", async () => {
    await expectRejected({});
    const id = env.GUILD_HIKE.idFromName(guildId).toString();
    expect(await guildObjectIds()).not.toContain(id);
  });
});

describe("POST /interactions dispatch", () => {
  it("answers a signed PING with a PONG", async () => {
    const response = await callWorker(
      signer,
      await signedRequest(signer, { type: 1, id: "1", application_id: "1" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 1 });
  });

  it("tells users outside a server that the bot only works in servers", async () => {
    const response = await callWorker(
      signer,
      await signedRequest(signer, commandInteraction("hike", null)),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      ephemeralTextReply(GUILD_ONLY_MESSAGE),
    );
  });

  it("routes each guild to the GuildHike object named by its guild_id", async () => {
    const guilds = ["111111111", "222222222"];
    for (const guildId of guilds) {
      const response = await callWorker(
        signer,
        await signedRequest(signer, commandInteraction("unknown", guildId)),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(
        ephemeralTextReply(UNAVAILABLE_MESSAGE),
      );
    }
    const [first, second] = guilds.map((guildId) =>
      env.GUILD_HIKE.idFromName(guildId).toString(),
    );
    expect(first).not.toBe(second);
    const ids = await guildObjectIds();
    expect(ids).toContain(first);
    expect(ids).toContain(second);
  });
});
