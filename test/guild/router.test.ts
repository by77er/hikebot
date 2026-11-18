import { env } from "cloudflare:workers";
import { InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import { ephemeralNotice } from "../../src/discord/responses";
import {
  Router,
  UNAVAILABLE_MESSAGE,
  type HandlerContext,
} from "../../src/guild/router";
import {
  commandInteraction,
  componentInteraction,
  modalInteraction,
} from "../helpers";

const context = { env } as HandlerContext;

function reply(text: string) {
  return { response: ephemeralNotice(text) };
}

describe("Router", () => {
  it("dispatches commands by name", async () => {
    const router = new Router().command("hike", () => reply("hike"));
    expect(await router.dispatch(commandInteraction("hike"), context)).toEqual(
      reply("hike"),
    );
  });

  it("dispatches components and modals by custom_id prefix", async () => {
    const router = new Router()
      .component("hb:poll", () => reply("poll"))
      .component("hb:poll:vote", () => reply("vote"))
      .modal("hb:location:propose", () => reply("propose"));

    const dispatch = (id: string, modal = false) =>
      router.dispatch(
        modal ? modalInteraction(id) : componentInteraction(id),
        context,
      );

    expect(await dispatch("hb:poll:vote:12")).toEqual(reply("vote"));
    expect(await dispatch("hb:poll:vote")).toEqual(reply("vote"));
    expect(await dispatch("hb:poll:close:12")).toEqual(reply("poll"));
    expect(await dispatch("hb:location:propose", true)).toEqual(
      reply("propose"),
    );
  });

  it("does not match a prefix in the middle of a segment", async () => {
    const router = new Router().component("hb:poll:vote", () => reply("vote"));
    expect(
      await router.dispatch(componentInteraction("hb:poll:voter"), context),
    ).toEqual(reply(UNAVAILABLE_MESSAGE));
  });

  it("keeps components and modals apart", async () => {
    const router = new Router().component("hb:poll:vote", () => reply("vote"));
    expect(
      await router.dispatch(modalInteraction("hb:poll:vote"), context),
    ).toEqual(reply(UNAVAILABLE_MESSAGE));
  });

  it("answers unknown commands and custom_ids as no longer available", async () => {
    const router = new Router();
    for (const interaction of [
      commandInteraction("nope"),
      componentInteraction("hb:nope:x"),
      modalInteraction("hb:nope:x"),
    ]) {
      const result = await router.dispatch(interaction, context);
      expect(result.response.type).toBe(
        InteractionResponseType.ChannelMessageWithSource,
      );
      expect(result).toEqual(reply(UNAVAILABLE_MESSAGE));
    }
  });

  it("refuses duplicate registrations and badly formed prefixes", () => {
    const router = new Router().command("hike", () => reply("a"));
    expect(() => router.command("hike", () => reply("b"))).toThrow(
      /already registered/,
    );
    expect(() => router.component("poll:vote", () => reply("c"))).toThrow(
      /hb:<feature>/,
    );
    expect(() => router.modal("hb:a:b:c", () => reply("d"))).toThrow(
      /hb:<feature>/,
    );
  });

  it("finds jobs by name and refuses duplicate or badly formed job names", () => {
    const refresh = () => Promise.resolve();
    const router = new Router().job("poll:refresh", refresh);
    expect(router.jobHandler("poll:refresh")).toBe(refresh);
    expect(router.jobHandler("poll:other")).toBeUndefined();
    expect(() => router.job("poll:refresh", refresh)).toThrow(
      /already registered/,
    );
    for (const name of ["refresh", "hb:poll:refresh", "Poll:refresh"]) {
      expect(() => router.job(name, refresh)).toThrow(/<feature>:<action>/);
    }
  });
});
