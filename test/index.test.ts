import {
  createExecutionContext,
  listDurableObjectIds,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import {
  ComponentType,
  InteractionResponseType,
  MessageFlags,
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as entry from "../src";
import { GUILD_ONLY_MESSAGE, ephemeralNotice } from "../src/discord/responses";
import type { GuildHike } from "../src/guild/guild-hike";
import { UNAVAILABLE_MESSAGE } from "../src/guild/router";
import {
  callWorker,
  commandInteraction,
  componentInteraction,
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
  it("serves GET /healthz from the deployed entry module", async () => {
    const response = await exports.default.fetch(
      "https://hikebot.example/healthz",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hikebot is running\n");
  });

  it("answers GET /healthz with a plain-text health line", async () => {
    const response = await callWorker(
      signer,
      new IncomingRequest("https://hikebot.example/healthz"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(await response.text()).toBe("hikebot is running\n");
  });

  it("answers GET / with the landing page", async () => {
    const response = await exports.default.fetch("https://hikebot.example/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(await response.text()).toMatch(/^<!doctype html>/);
  });

  it("serves the stylesheet through the Worker's fetch", async () => {
    const response = await exports.default.fetch(
      "https://hikebot.example/assets/app.css",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/css; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    await response.arrayBuffer();
  });

  it("returns the HTML 404 page for unknown paths", async () => {
    const response = await callWorker(
      signer,
      new IncomingRequest("https://hikebot.example/nope"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
    await response.arrayBuffer();
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

describe("POST /interactions follow-ups", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Sends the interaction and waits for its follow-up; returns the logs. */
  async function sendAndLog(interaction: object): Promise<string[]> {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = createExecutionContext();
    const response = await callWorker(
      signer,
      await signedRequest(signer, interaction),
      ctx,
    );
    expect(await response.json()).toEqual(ephemeralNotice("working on it"));
    await waitOnExecutionContext(ctx);
    return errors.mock.calls.map((call) => call.join(" "));
  }

  it("logs a follow-up the guild object no longer has, once, by id and custom_id", async () => {
    const guildId = "333333331";
    await runInDurableObject(
      env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId)),
      (instance: GuildHike) => {
        instance.router.component("hb:lost:go", () => ({
          response: ephemeralNotice("working on it"),
          followUp: () => Promise.resolve(),
        }));
        // As if the object restarted between the answer and the follow-up.
        const kept = (
          instance as unknown as { followUps: Map<string, unknown> }
        ).followUps;
        kept.set = () => kept;
      },
    );
    const interaction = componentInteraction("hb:lost:go:7", guildId);
    const logs = await sendAndLog(interaction);
    expect(logs).toEqual([
      `follow-up for interaction ${interaction.id} (hb:lost:go:7) was lost: the guild object restarted before it ran`,
    ]);
    expect(logs.join("\n")).not.toContain(interaction.token);
  });

  it("logs a follow-up that failed, once, by id and command name", async () => {
    const guildId = "333333332";
    await runInDurableObject(
      env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId)),
      (instance: GuildHike) => {
        instance.router.command("broken", () => ({
          response: ephemeralNotice("working on it"),
          followUp: () =>
            Promise.reject(new Error("Discord could not be reached")),
        }));
      },
    );
    const interaction = commandInteraction("broken", guildId);
    const logs = await sendAndLog(interaction);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(
      `follow-up for interaction ${interaction.id} (/broken) failed:`,
    );
    expect(logs[0]).toContain("Discord could not be reached");
    expect(logs[0]).not.toContain(interaction.token);
  });

  it("logs nothing for a follow-up that ran", async () => {
    const guildId = "333333333";
    await runInDurableObject(
      env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId)),
      (instance: GuildHike) => {
        instance.router.command("fine", () => ({
          response: ephemeralNotice("working on it"),
          followUp: () => Promise.resolve(),
        }));
      },
    );
    expect(await sendAndLog(commandInteraction("fine", guildId))).toEqual([]);
  });
});
