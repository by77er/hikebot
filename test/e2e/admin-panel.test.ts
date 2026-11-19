import {
  ChannelType,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import {
  findComponent,
  getComponent,
  Member,
  messageText,
} from "./harness/helpers";
import { subcommand, type Actor } from "./harness/interactions";
import { useE2E } from "./harness/worker";
import type { FakeMessage } from "./harness/fake-discord";

const e2e = useE2E();

const ADMIN_ONLY_NO_ROLE =
  "The hikebot admin panel is limited to the server owner and members with the admin role. No admin role is set yet, so only the server owner can use it.";
const ADMIN_ONLY =
  "The hikebot admin panel is limited to the server owner and members with the admin role.";

const ID = {
  settings: "hb:admin:settings",
  refresh: "hb:admin:refresh",
  back: "hb:admin:back",
  role: "hb:admin:role",
  vote: "hb:admin:vote-channel",
  announce: "hb:admin:announce-channel",
  forum: "hb:admin:forum-channel",
  timezone: "hb:admin:timezone",
  timezoneName: "hb:admin:timezone-name",
  cadence: "hb:admin:cadence",
  cadenceDay: "hb:admin:cadence-day",
  cadenceDays: "hb:admin:cadence-days",
  cadenceTime: "hb:admin:cadence-time",
  cadenceTimeValue: "hb:admin:cadence-time-value",
};

const CLOCK = / · now (?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d/g;

/** A panel's text with the clock masked, to compare views drawn apart. */
function steady(text: string): string {
  return text.replace(CLOCK, " · now <clock>");
}

/**
 * A guild with an owner, a would-be admin, a stranger and one channel of
 * each type the settings take. `n` keeps each test's ids apart.
 */
function guild(n: number) {
  const guildId = `2000000000000001${String(n).padStart(2, "0")}`;
  const id = (prefix: string, i: number) =>
    `${prefix}0000000000001${String(n).padStart(2, "0")}${String(i)}`;
  const channels = {
    text: id("30", 1),
    news: id("30", 2),
    forum: id("30", 3),
  };
  const role = id("50", 1);
  const actor = (userId: string, roles: string[] = []): Actor => ({
    guildId,
    channelId: channels.text,
    userId,
    roles,
  });
  e2e.discord.addGuild({ id: guildId, ownerId: id("40", 1) });
  e2e.discord.addChannel({ id: channels.text, guildId });
  e2e.discord.addChannel({
    id: channels.news,
    guildId,
    type: ChannelType.GuildAnnouncement,
  });
  e2e.discord.addChannel({
    id: channels.forum,
    guildId,
    type: ChannelType.GuildForum,
  });
  return {
    guildId,
    channels,
    role,
    owner: new Member(e2e.client, actor(id("40", 1))),
    lead: new Member(e2e.client, actor(id("40", 2), [role])),
    stranger: new Member(e2e.client, actor(id("40", 3))),
  };
}

/** The panel message as the fake stores it now. */
function shown(panel: { id: string }): FakeMessage {
  const message = e2e.discord.message(panel.id);
  if (!message) throw new Error(`message ${panel.id} is not stored`);
  return message;
}

function expectEphemeralV2(message: FakeMessage) {
  expect(message.ephemeral).toBe(true);
  expect(message.flags & MessageFlags.IsComponentsV2).toBe(
    MessageFlags.IsComponentsV2,
  );
}

function expectRefused(
  response: APIInteractionResponse,
  member: Member,
  text: string,
) {
  expect(response.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  const reply = member.lastReply();
  expectEphemeralV2(reply);
  expect(messageText(reply)).toBe(text);
}

describe("the admin panel", () => {
  it("opens for the owner with every setting not set", async () => {
    const { owner } = guild(1);
    const response = await owner.run("hike", [subcommand("admin")]);
    expect(response.type).toBe(
      InteractionResponseType.ChannelMessageWithSource,
    );
    const panel = owner.lastReply();
    expectEphemeralV2(panel);
    const text = messageText(panel);
    expect(text).toContain("hikebot admin");
    expect(text).toContain("Admin role:** not set");
    expect(text).toContain("Voting channel:** not set");
    expect(text).toContain("Setup is not complete");
    expect(findComponent(panel.components, ID.settings)).toBeDefined();
    expect(findComponent(panel.components, ID.refresh)).toBeDefined();
  });

  it("refuses a stranger", async () => {
    const { stranger } = guild(2);
    const response = await stranger.run("hike", [subcommand("admin")]);
    expectRefused(response, stranger, ADMIN_ONLY_NO_ROLE);
  });

  it("keeps the panel closed when Discord cannot say who owns the server", async () => {
    const owner = new Member(e2e.client, {
      guildId: "200000000000000199",
      channelId: "300000000000000199",
      userId: "400000000000000199",
    });
    const response = await owner.run("hike", [subcommand("admin")]);
    expect(response.type).toBe(
      InteractionResponseType.ChannelMessageWithSource,
    );
    const lookup = await e2e.discord.nextRequest(
      (r) => r.method === "GET" && r.route === "/guilds/200000000000000199",
    );
    expect(lookup.status).toBe(404);
    const reply = owner.lastReply();
    expectEphemeralV2(reply);
    expect(messageText(reply)).toContain(
      "Could not check who owns this server, so the admin panel stays closed.",
    );
  });

  it("saves the role and the three channels picked by the owner, lets the role in and keeps the settings", async () => {
    const { owner, lead, stranger, role, channels } = guild(3);
    await owner.run("hike", [subcommand("admin")]);
    const panel = owner.lastReply();

    const settings = await owner.click(panel, ID.settings);
    expect(settings.type).toBe(InteractionResponseType.UpdateMessage);
    expect(getComponent(shown(panel).components, ID.role).type).toBe(
      ComponentType.RoleSelect,
    );

    await owner.select(panel, ID.role, [role]);
    expect(messageText(shown(panel))).toContain(
      `Admin role set to <@&${role}>.`,
    );
    await owner.select(panel, ID.vote, [channels.text]);
    await owner.select(panel, ID.announce, [channels.news]);
    await owner.select(panel, ID.forum, [channels.forum]);
    expect(messageText(shown(panel))).toContain(
      `Hike threads channel set to <#${channels.forum}>.`,
    );
    expect(
      getComponent(shown(panel).components, ID.vote).default_values,
    ).toEqual([{ id: channels.text, type: "channel" }]);

    await owner.click(panel, ID.back);
    const status = steady(messageText(shown(panel)));
    expect(status).toContain(`Admin role:** <@&${role}>`);
    expect(status).toContain(`Voting channel:** <#${channels.text}>`);
    expect(status).toContain(`Announcements channel:** <#${channels.news}>`);
    expect(status).toContain(`Hike threads channel:** <#${channels.forum}>`);
    expect(status).toContain("Setup is complete.");

    await owner.click(panel, ID.refresh);
    expect(steady(messageText(shown(panel)))).toBe(status);

    await lead.run("hike", [subcommand("admin")]);
    expect(steady(messageText(lead.lastReply()))).toBe(status);

    const refused = await stranger.run("hike", [subcommand("admin")]);
    expectRefused(refused, stranger, ADMIN_ONLY);

    await owner.run("hike", [subcommand("admin")]);
    expect(steady(messageText(owner.lastReply()))).toBe(status);
  });

  it("refuses a non-admin replaying the settings controls, and keeps the settings", async () => {
    const { owner, stranger, role, channels } = guild(4);
    await owner.run("hike", [subcommand("admin")]);
    const panel = owner.lastReply();
    await owner.click(panel, ID.settings);
    await owner.select(panel, ID.role, [role]);
    const before = steady(messageText(shown(panel)));

    expectRefused(
      await stranger.select(panel, ID.vote, [channels.text]),
      stranger,
      ADMIN_ONLY,
    );
    expectRefused(
      await stranger.select(panel, ID.role, []),
      stranger,
      ADMIN_ONLY,
    );
    expectRefused(await stranger.click(panel, ID.back), stranger, ADMIN_ONLY);
    expect(steady(messageText(shown(panel)))).toBe(before);

    await owner.click(panel, ID.back);
    const status = messageText(shown(panel));
    expect(status).toContain(`Admin role:** <@&${role}>`);
    expect(status).toContain("Voting channel:** not set");
  });

  it("sets the time zone through its modal and shows it in both views", async () => {
    const { owner, stranger, role } = guild(6);
    await owner.run("hike", [subcommand("admin")]);
    const panel = owner.lastReply();
    expect(messageText(panel)).toMatch(
      /\*\*Time zone:\*\* America\/Los_Angeles · now (?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d/,
    );
    await owner.click(panel, ID.settings);
    await owner.select(panel, ID.role, [role]);
    expect(messageText(shown(panel))).toContain(
      "**Time zone:** America/Los_Angeles · now ",
    );

    const opened = await owner.click(panel, ID.timezone);
    expect(opened.type).toBe(InteractionResponseType.Modal);
    if (opened.type !== InteractionResponseType.Modal) return;
    expect(opened.data.title).toBe("Set time zone");
    expect(opened.data.components[0]).toMatchObject({
      type: ComponentType.Label,
      component: { custom_id: ID.timezoneName, value: "America/Los_Angeles" },
    });

    const saved = await owner.submitModal(
      opened,
      { [ID.timezoneName]: "america/denver" },
      panel,
    );
    expect(saved.type).toBe(InteractionResponseType.UpdateMessage);
    expect(messageText(shown(panel))).toContain(
      "Time zone set to America/Denver.",
    );
    expect(messageText(shown(panel))).toContain(
      "**Time zone:** America/Denver · now ",
    );

    // Something that is not a zone changes nothing and says what would.
    const again = await owner.click(panel, ID.timezone);
    if (again.type !== InteractionResponseType.Modal) {
      throw new Error("Set time zone did not open its modal again");
    }
    expect(again.data.components[0]).toMatchObject({
      component: { value: "America/Denver" },
    });
    const refused = await owner.submitModal(
      again,
      { [ID.timezoneName]: "Mars/Olympus" },
      panel,
    );
    expect(refused.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    const reply = owner.lastReply();
    expectEphemeralV2(reply);
    expect(messageText(reply)).toContain(
      "`Mars/Olympus` is not a time zone, so it is still America/Denver.",
    );
    expect(messageText(reply)).toContain(
      "`America/Los_Angeles`, `Europe/Berlin` or `Asia/Kolkata`",
    );

    // A stranger cannot open the modal.
    expectRefused(
      await stranger.click(panel, ID.timezone),
      stranger,
      ADMIN_ONLY,
    );

    await owner.click(panel, ID.back);
    expect(messageText(shown(panel))).toMatch(
      /\*\*Time zone:\*\* America\/Denver · now (?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d/,
    );
  });

  it("refuses @everyone as the admin role and a channel of the wrong type", async () => {
    const { owner, guildId, channels } = guild(5);
    await owner.run("hike", [subcommand("admin")]);
    const panel = owner.lastReply();
    await owner.click(panel, ID.settings);

    await owner.select(panel, ID.role, [guildId]);
    expect(messageText(shown(panel))).toContain(
      "The @everyone role cannot be the admin role.",
    );
    // The forum select offers forum channels only; a text channel picked
    // anyway, as a stale client could send, is refused.
    await owner.select(panel, ID.forum, [channels.text]);
    expect(messageText(shown(panel))).toContain(
      "That channel cannot be the hike threads channel.",
    );

    await owner.click(panel, ID.back);
    const status = messageText(shown(panel));
    expect(status).toContain("Admin role:** not set");
    expect(status).toContain("Hike threads channel:** not set");
  });
});

/** The weekday and HH:MM a Unix time in seconds reads as in `zone`. */
function wallTime(seconds: number, zone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(seconds * 1000);
}

describe("the schedule", () => {
  it("is refused until the channels are set, then turned on from Settings with its next action, and off", async () => {
    const { owner, channels } = guild(7);
    await owner.run("hike", [subcommand("admin")]);
    const panel = owner.lastReply();
    expect(messageText(panel)).toContain("**Schedule:** off");

    await owner.click(panel, ID.settings);
    await owner.select(panel, ID.vote, [channels.text]);
    await owner.click(panel, ID.cadence);
    expect(messageText(shown(panel))).toContain(
      "The schedule needs the announcements channel and hike threads channel. Set them above, then turn it on.",
    );
    expect(messageText(shown(panel))).toContain("**Schedule:** off");

    await owner.select(panel, ID.announce, [channels.news]);
    await owner.select(panel, ID.forum, [channels.forum]);
    await owner.select(panel, ID.cadenceDay, ["5"]);
    expect(messageText(shown(panel))).toContain(
      "The schedule's day is Friday.",
    );
    await owner.select(panel, ID.cadenceDays, ["3"]);
    const form = await owner.click(panel, ID.cadenceTime);
    await owner.submitModal(form, { [ID.cadenceTimeValue]: "18:30" }, panel);
    expect(messageText(shown(panel))).toContain(
      "The schedule's time is 18:30 (America/Los_Angeles).",
    );

    await owner.click(panel, ID.cadence);
    expect(messageText(shown(panel))).toContain("The schedule is on.");
    expect(getComponent(shown(panel).components, ID.cadence)).toMatchObject({
      label: "Turn schedule off",
    });

    await owner.click(panel, ID.back);
    const status = messageText(shown(panel));
    const line =
      /\*\*Schedule:\*\* on · Fridays at 18:30 \(America\/Los_Angeles\) · date vote 3 days\n\*\*Next:\*\* Opens a location vote <t:(\d+):F> \(<t:\1:R>\)\./.exec(
        status,
      );
    expect(line, status).not.toBeNull();
    const next = Number(line?.[1]);
    expect(wallTime(next, "America/Los_Angeles")).toBe("Fri 18:30");
    expect(next * 1000).toBeGreaterThan(Date.now());
    expect(next * 1000).toBeLessThanOrEqual(Date.now() + 7 * 86_400_000);

    await owner.click(panel, ID.settings);
    await owner.click(panel, ID.cadence);
    expect(messageText(shown(panel))).toContain(
      "The schedule is off. Open votes stay open until an admin closes them.",
    );
    await owner.click(panel, ID.back);
    expect(messageText(shown(panel))).toContain("**Schedule:** off");
  });
});
