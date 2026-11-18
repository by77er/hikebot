import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { ephemeralNotice } from "../../src/discord/responses";
import type { GuildHike } from "../../src/guild/guild-hike";
import { UNAVAILABLE_MESSAGE } from "../../src/guild/router";
import {
  callWorker,
  commandInteraction,
  componentInteraction,
  createSigner,
  modalInteraction,
  signedRequest,
  type Signer,
} from "../helpers";

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});

function guildStub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

describe("GuildHike.handleInteraction", () => {
  it("answers unknown commands and custom_ids as no longer available", async () => {
    const stub = guildStub("3001");
    for (const interaction of [
      commandInteraction("nope", "3001"),
      componentInteraction("hb:nope:x", "3001"),
      modalInteraction("hb:nope:x", "3001"),
    ]) {
      expect(await stub.handleInteraction(interaction)).toEqual({
        response: ephemeralNotice(UNAVAILABLE_MESSAGE),
        followUp: false,
      });
    }
  });

  it("reaches registered command, component and modal handlers through the Worker", async () => {
    const guildId = "3002";
    const seen: string[] = [];
    await runInDurableObject(guildStub(guildId), (instance: GuildHike) => {
      instance.router
        .command("sample", (interaction) => {
          seen.push(`command ${interaction.data.name}`);
          return { response: ephemeralNotice("command") };
        })
        .component("hb:sample:press", (interaction) => {
          seen.push(`component ${interaction.data.custom_id}`);
          return { response: ephemeralNotice("component") };
        })
        .modal("hb:sample:submit", (interaction) => {
          seen.push(`modal ${interaction.data.custom_id}`);
          return { response: ephemeralNotice("modal") };
        });
    });

    const cases = [
      [commandInteraction("sample", guildId), "command"],
      [componentInteraction("hb:sample:press:7", guildId), "component"],
      [modalInteraction("hb:sample:submit", guildId), "modal"],
    ] as const;
    for (const [interaction, text] of cases) {
      const response = await callWorker(
        signer,
        await signedRequest(signer, interaction),
      );
      expect(await response.json()).toEqual(ephemeralNotice(text));
    }
    expect(seen).toEqual([
      "command sample",
      "component hb:sample:press:7",
      "modal hb:sample:submit",
    ]);
  });
});

describe("follow-up jobs", () => {
  it("returns the response first, then runs the follow-up to completion", async () => {
    const guildId = "3003";
    const events: string[] = [];
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    await runInDurableObject(guildStub(guildId), (instance: GuildHike) => {
      instance.router.command("slow", () => {
        events.push("handled");
        return {
          response: ephemeralNotice("working on it"),
          followUp: async () => {
            events.push("follow-up started");
            await released;
            events.push("follow-up finished");
          },
        };
      });
    });

    const ctx = createExecutionContext();
    const response = await callWorker(
      signer,
      await signedRequest(signer, commandInteraction("slow", guildId)),
      ctx,
    );
    expect(await response.json()).toEqual(ephemeralNotice("working on it"));
    expect(events).not.toContain("follow-up finished");

    release();
    await waitOnExecutionContext(ctx);
    expect(events).toEqual([
      "handled",
      "follow-up started",
      "follow-up finished",
    ]);
  });

  it("runs each follow-up once and reports a missing one", async () => {
    const stub = guildStub("3004");
    let runs = 0;
    await runInDurableObject(stub, (instance: GuildHike) => {
      instance.router.command("once", () => ({
        response: ephemeralNotice("ok"),
        followUp: () => {
          runs++;
          return Promise.resolve();
        },
      }));
    });
    const interaction = commandInteraction("once", "3004");
    expect((await stub.handleInteraction(interaction)).followUp).toBe(true);
    expect(await stub.runFollowUp(interaction.id)).toBe(true);
    expect(await stub.runFollowUp(interaction.id)).toBe(false);
    expect(runs).toBe(1);
  });
});
