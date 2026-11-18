import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
  SeparatorSpacingSize,
  TextInputStyle,
  type APIModalSubmission,
} from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import {
  actionRow,
  button,
  channelSelect,
  container,
  customId,
  deferredReply,
  deferredUpdate,
  ephemeralReply,
  label,
  messageBody,
  modal,
  parseCustomId,
  reply,
  roleSelect,
  section,
  selectValues,
  separator,
  stringSelect,
  textDisplay,
  textInput,
  textInputValue,
  update,
} from "../../src/discord/components";

const vote = button({ custom_id: "hb:poll:vote:1", label: "Vote" });

describe("message builders", () => {
  it("textDisplay", () => {
    expect(textDisplay("Hi")).toEqual({
      type: ComponentType.TextDisplay,
      content: "Hi",
    });
  });

  it("container", () => {
    expect(container([textDisplay("a")])).toEqual({
      type: ComponentType.Container,
      components: [{ type: ComponentType.TextDisplay, content: "a" }],
    });
    expect(container([], { accent_color: 0x2e7d32 })).toEqual({
      type: ComponentType.Container,
      accent_color: 0x2e7d32,
      components: [],
    });
  });

  it("section with a button accessory", () => {
    expect(section(["Ridge trail", "3 votes"], vote)).toEqual({
      type: ComponentType.Section,
      components: [
        { type: ComponentType.TextDisplay, content: "Ridge trail" },
        { type: ComponentType.TextDisplay, content: "3 votes" },
      ],
      accessory: vote,
    });
    expect(section("one", vote).components).toEqual([textDisplay("one")]);
  });

  it("separator", () => {
    expect(separator()).toEqual({ type: ComponentType.Separator });
    expect(
      separator({ divider: false, spacing: SeparatorSpacingSize.Large }),
    ).toEqual({
      type: ComponentType.Separator,
      divider: false,
      spacing: SeparatorSpacingSize.Large,
    });
  });

  it("button defaults to primary", () => {
    expect(vote).toEqual({
      type: ComponentType.Button,
      style: ButtonStyle.Primary,
      custom_id: "hb:poll:vote:1",
      label: "Vote",
    });
    expect(
      button({
        custom_id: "hb:poll:close:1",
        label: "Close",
        style: ButtonStyle.Danger,
        disabled: true,
      }),
    ).toEqual({
      type: ComponentType.Button,
      style: ButtonStyle.Danger,
      custom_id: "hb:poll:close:1",
      label: "Close",
      disabled: true,
    });
  });

  it("actionRow", () => {
    expect(actionRow(vote)).toEqual({
      type: ComponentType.ActionRow,
      components: [vote],
    });
  });

  it("stringSelect", () => {
    const options = [{ label: "Ridge", value: "1", default: true }];
    expect(
      stringSelect({ custom_id: "hb:poll:pick:1", options, max_values: 1 }),
    ).toEqual({
      type: ComponentType.StringSelect,
      custom_id: "hb:poll:pick:1",
      options,
      max_values: 1,
    });
  });

  it("stringSelect enforces Discord's option count", () => {
    const option = (i: number) => ({ label: String(i), value: String(i) });
    expect(() => stringSelect({ custom_id: "hb:a:b", options: [] })).toThrow(
      /1 to 25/,
    );
    expect(() =>
      stringSelect({
        custom_id: "hb:a:b",
        options: Array.from({ length: 26 }, (_, i) => option(i)),
      }),
    ).toThrow(/got 26/);
    expect(
      stringSelect({
        custom_id: "hb:a:b",
        options: Array.from({ length: 25 }, (_, i) => option(i)),
      }).options,
    ).toHaveLength(25);
  });

  it("roleSelect", () => {
    expect(roleSelect({ custom_id: "hb:admin:role" })).toEqual({
      type: ComponentType.RoleSelect,
      custom_id: "hb:admin:role",
    });
  });

  it("channelSelect", () => {
    expect(
      channelSelect({
        custom_id: "hb:admin:forum",
        channel_types: [ChannelType.GuildForum],
      }),
    ).toEqual({
      type: ComponentType.ChannelSelect,
      custom_id: "hb:admin:forum",
      channel_types: [ChannelType.GuildForum],
    });
  });
});

describe("modal builders", () => {
  const name = textInput({ custom_id: "hb:location:name", max_length: 80 });

  it("textInput defaults to short", () => {
    expect(name).toEqual({
      type: ComponentType.TextInput,
      style: TextInputStyle.Short,
      custom_id: "hb:location:name",
      max_length: 80,
    });
    expect(
      textInput({ custom_id: "x", style: TextInputStyle.Paragraph }).style,
    ).toBe(TextInputStyle.Paragraph);
  });

  it("label", () => {
    expect(label("Location", name)).toEqual({
      type: ComponentType.Label,
      label: "Location",
      component: name,
    });
    expect(label("Location", name, "Where to hike")).toEqual({
      type: ComponentType.Label,
      label: "Location",
      description: "Where to hike",
      component: name,
    });
  });

  it("modal", () => {
    expect(
      modal("hb:location:propose", "Propose a location", [
        label("Location", name),
      ]),
    ).toEqual({
      type: InteractionResponseType.Modal,
      data: {
        custom_id: "hb:location:propose",
        title: "Propose a location",
        components: [label("Location", name)],
      },
    });
  });
});

describe("response helpers", () => {
  const components = [container([textDisplay("Saved")])];
  const v2 = MessageFlags.IsComponentsV2;

  it("reply", () => {
    expect(reply(components)).toEqual({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { flags: v2, components, allowed_mentions: { parse: [] } },
    });
  });

  it("ephemeralReply", () => {
    expect(ephemeralReply(components)).toEqual({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        flags: v2 | MessageFlags.Ephemeral,
        components,
        allowed_mentions: { parse: [] },
      },
    });
    expect(ephemeralReply(components).data.flags).toBe(32768 | 64);
  });

  it("update", () => {
    expect(update(components)).toEqual({
      type: InteractionResponseType.UpdateMessage,
      data: { flags: v2, components, allowed_mentions: { parse: [] } },
    });
  });

  it("deferredReply carries only the ephemeral flag Discord allows", () => {
    expect(deferredReply()).toEqual({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
    });
    expect(deferredReply({ ephemeral: true })).toEqual({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral },
    });
  });

  it("deferredUpdate", () => {
    expect(deferredUpdate()).toEqual({
      type: InteractionResponseType.DeferredMessageUpdate,
    });
  });

  it("messageBody", () => {
    expect(messageBody(components)).toEqual({
      flags: v2,
      components,
      allowed_mentions: { parse: [] },
    });
    expect(messageBody(components, { ephemeral: true }).flags).toBe(
      v2 | MessageFlags.Ephemeral,
    );
  });

  it("no message helper emits content or embeds", () => {
    for (const data of [
      reply(components).data,
      ephemeralReply(components).data,
      update(components).data,
      messageBody(components),
    ]) {
      expect(data).not.toHaveProperty("content");
      expect(data).not.toHaveProperty("embeds");
      expect((data?.flags ?? 0) & v2).toBe(v2);
    }
  });
});

describe("modal submit values", () => {
  const withLabels: APIModalSubmission = {
    custom_id: "hb:location:propose",
    components: [
      { type: ComponentType.TextDisplay },
      {
        type: ComponentType.Label,
        component: {
          type: ComponentType.TextInput,
          custom_id: "hb:location:name",
          value: "Ridge trail",
        },
      },
      {
        type: ComponentType.Label,
        component: {
          type: ComponentType.StringSelect,
          custom_id: "hb:location:area",
          values: ["north", "east"],
        },
      },
      {
        type: ComponentType.Label,
        component: {
          type: ComponentType.ChannelSelect,
          custom_id: "hb:admin:forum",
          values: ["123"],
        },
      },
    ],
  };

  const withRows: APIModalSubmission = {
    custom_id: "hb:location:propose",
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            custom_id: "hb:location:name",
            value: "Lake loop",
          },
        ],
      },
    ],
  };

  it("reads a text input inside a Label", () => {
    expect(textInputValue(withLabels, "hb:location:name")).toBe("Ridge trail");
  });

  it("reads a text input inside an action row", () => {
    expect(textInputValue(withRows, "hb:location:name")).toBe("Lake loop");
  });

  it("reads select values inside a Label", () => {
    expect(selectValues(withLabels, "hb:location:area")).toEqual([
      "north",
      "east",
    ]);
    expect(selectValues(withLabels, "hb:admin:forum")).toEqual(["123"]);
  });

  it("returns nothing for a missing or mismatched field", () => {
    expect(textInputValue(withLabels, "hb:nope:x")).toBeUndefined();
    expect(textInputValue(withLabels, "hb:location:area")).toBeUndefined();
    expect(selectValues(withLabels, "hb:nope:x")).toEqual([]);
    expect(selectValues(withRows, "hb:location:name")).toEqual([]);
  });
});

describe("customId", () => {
  it("builds and parses hb:<feature>:<action>", () => {
    expect(customId("poll", "vote")).toBe("hb:poll:vote");
    expect(parseCustomId("hb:poll:vote")).toEqual({
      feature: "poll",
      action: "vote",
    });
  });

  it("round-trips an arg, including one with colons", () => {
    for (const arg of ["12", "2026-05-01 09:30", ""]) {
      const id = customId("date-vote", "pick", arg);
      expect(parseCustomId(id)).toEqual({
        feature: "date-vote",
        action: "pick",
        arg,
      });
    }
    expect(customId("poll", "vote", "12")).toBe("hb:poll:vote:12");
  });

  it("rejects bad segments", () => {
    expect(() => customId("Poll", "vote")).toThrow();
    expect(() => customId("poll", "vo:te")).toThrow();
    expect(() => customId("", "vote")).toThrow();
  });

  it("throws past 100 characters", () => {
    const fits = customId(
      "poll",
      "vote",
      "x".repeat(100 - "hb:poll:vote:".length),
    );
    expect(fits).toHaveLength(100);
    expect(() =>
      customId("poll", "vote", "x".repeat(101 - "hb:poll:vote:".length)),
    ).toThrow(/101 characters/);
  });

  it("parseCustomId rejects ids outside the scheme", () => {
    for (const id of [
      "vote_12",
      "hb:poll",
      "xx:poll:vote",
      "hb:Poll:vote",
      "hb::vote",
    ]) {
      expect(parseCustomId(id)).toBeUndefined();
    }
  });
});
