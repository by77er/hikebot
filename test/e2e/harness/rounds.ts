/**
 * Steps of a hike round as an admin and members take them, for scenarios
 * that play the location and date votes: a guild set up with its channels,
 * the panel, starting and closing each vote, and voting.
 */
import {
  ChannelType,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
} from "discord-api-types/v10";
import { expect } from "vitest";
import type { FakeMessage } from "./fake-discord";
import { allComponents, eventually, Member, messageText } from "./helpers";
import { subcommand, type Actor } from "./interactions";
import type { E2E } from "./worker";

export const ROUND_IDS = {
  settings: "hb:admin:settings",
  back: "hb:admin:back",
  refresh: "hb:admin:refresh",
  voteChannel: "hb:admin:vote-channel",
  announceChannel: "hb:admin:announce-channel",
  forumChannel: "hb:admin:forum-channel",
  timezone: "hb:admin:timezone",
  timezoneName: "hb:admin:timezone-name",
  startLocation: "hb:location:start",
  initial: "hb:location:initial",
  startDate: "hb:date:start",
  dates: "hb:date:dates",
  day: "hb:date:day",
  cadence: "hb:admin:cadence",
  cadenceDay: "hb:admin:cadence-day",
  cadenceTime: "hb:admin:cadence-time",
  cadenceTimeValue: "hb:admin:cadence-time-value",
};

/** A guild with its owner, members and channels, as `RoundPlayer.guild` makes it. */
export interface TestGuild {
  guildId: string;
  channels: { text: string; news: string; forum: string };
  owner: Member;
  members: Member[];
}

/** The custom_ids on a message that start with `prefix`. */
export function idsStarting(
  message: { components: unknown[] },
  prefix: string,
): string[] {
  return allComponents(message.components)
    .map((c) => c.custom_id)
    .filter((id): id is string => typeof id === "string")
    .filter((id) => id.startsWith(prefix));
}

/** The first custom_id on a message that starts with `prefix`. */
export function idStarting(
  message: { components: unknown[] },
  prefix: string,
): string {
  const [found] = idsStarting(message, prefix);
  if (found === undefined) {
    throw new Error(
      `no custom_id starting with ${prefix} in ${JSON.stringify(messageText(message))}`,
    );
  }
  return found;
}

/** The ids of the options in a vote select, by label. */
export function optionValues(select: FakeMessage): Record<string, string> {
  const component = allComponents(select.components).find(
    (c) => c.type === ComponentType.StringSelect,
  );
  const options = (component?.options ?? []) as {
    label: string;
    value: string;
  }[];
  return Object.fromEntries(options.map((o) => [o.label, o.value]));
}

/** The labels of the buttons on a message, in order. */
export function buttonLabels(message: { components: unknown[] }): string[] {
  return allComponents(message.components)
    .filter((c) => c.type === ComponentType.Button)
    .map((c) => String(c.label));
}

/** Plays rounds against the Worker and the fake of one test file. */
export class RoundPlayer {
  constructor(private readonly e2e: E2E) {}

  /**
   * A guild with an owner, 12 members (also members on the fake Discord
   * API, without roles), and a text, an announcement and a forum channel.
   * `n` (0-99) keeps each test's ids apart. `options` give the guild's name
   * and icon hash, and another owner's user id, such as a user who signs in
   * to the web pages as an admin.
   */
  guild(
    n: number,
    options: { name?: string; icon?: string; ownerId?: string } = {},
  ): TestGuild {
    const pad = String(n).padStart(2, "0");
    const guildId = `2200000000000001${pad}`;
    const id = (prefix: string, i: number) =>
      `${prefix}0000000000003${pad}${String(i).padStart(2, "0")}`;
    const channels = { text: id("3", 1), news: id("3", 2), forum: id("3", 3) };
    const actor = (userId: string): Actor => ({
      guildId,
      channelId: channels.text,
      userId,
    });
    const { discord } = this.e2e;
    const ownerId = options.ownerId ?? id("4", 0);
    discord.addGuild({
      id: guildId,
      ownerId,
      name: options.name,
      icon: options.icon,
    });
    discord.addChannel({ id: channels.text, guildId });
    discord.addChannel({
      id: channels.news,
      guildId,
      type: ChannelType.GuildAnnouncement,
    });
    discord.addChannel({
      id: channels.forum,
      guildId,
      type: ChannelType.GuildForum,
    });
    const members = Array.from({ length: 12 }, (_, i) => id("4", i + 1));
    for (const userId of members) discord.addMember(guildId, userId);
    return {
      guildId,
      channels,
      owner: new Member(this.e2e.client, actor(ownerId)),
      members: members.map(
        (userId) => new Member(this.e2e.client, actor(userId)),
      ),
    };
  }

  /** The message as the fake stores it now. */
  shown(message: { id: string }): FakeMessage {
    const stored = this.e2e.discord.message(message.id);
    if (!stored) throw new Error(`message ${message.id} is not stored`);
    return stored;
  }

  /** Opens the panel as the owner and sets the three channels. */
  async setUpPanel(g: TestGuild): Promise<FakeMessage> {
    await g.owner.run("hike", [subcommand("admin")]);
    const panel = g.owner.lastReply();
    await g.owner.click(panel, ROUND_IDS.settings);
    await g.owner.select(panel, ROUND_IDS.voteChannel, [g.channels.text]);
    await g.owner.select(panel, ROUND_IDS.announceChannel, [g.channels.news]);
    await g.owner.select(panel, ROUND_IDS.forumChannel, [g.channels.forum]);
    await g.owner.click(panel, ROUND_IDS.back);
    return panel;
  }

  /**
   * Sets the time zone through Settings and its modal, then goes back to
   * the status view, which shows the zone.
   */
  async setTimezone(
    g: TestGuild,
    panel: FakeMessage,
    typed: string,
    zone: string,
  ): Promise<void> {
    await g.owner.click(panel, ROUND_IDS.settings);
    const form = await g.owner.click(panel, ROUND_IDS.timezone);
    await g.owner.submitModal(form, { [ROUND_IDS.timezoneName]: typed }, panel);
    expect(messageText(this.shown(panel))).toContain(
      `Time zone set to ${zone}.`,
    );
    await g.owner.click(panel, ROUND_IDS.back);
    expect(messageText(this.shown(panel))).toContain(
      `**Time zone:** ${zone} · now `,
    );
  }

  /** Starts the location vote from the panel and returns the poll message. */
  async startLocationVote(
    g: TestGuild,
    panel: FakeMessage,
    initial: string,
  ): Promise<FakeMessage> {
    const before = this.e2e.discord.channelMessages(g.channels.text).length;
    const form = await g.owner.click(panel, ROUND_IDS.startLocation);
    const response = await g.owner.submitModal(
      form,
      { [ROUND_IDS.initial]: initial },
      panel,
    );
    expect(response.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    await eventually(() => {
      expect(messageText(this.shown(panel))).toContain(
        "The location vote is open",
      );
    });
    const poll = this.e2e.discord.channelMessages(g.channels.text)[before];
    if (!poll) throw new Error("the location poll was not posted");
    return poll;
  }

  /**
   * Submits the candidate dates in the Start date vote modal and returns
   * the answer to the submit.
   */
  async submitDates(g: TestGuild, panel: FakeMessage, dates: string) {
    const form = await g.owner.click(panel, ROUND_IDS.startDate);
    return g.owner.submitModal(form, { [ROUND_IDS.dates]: dates }, panel);
  }

  /** Starts the date vote from the panel and returns the poll message. */
  async startDateVote(
    g: TestGuild,
    panel: FakeMessage,
    dates: string,
  ): Promise<FakeMessage> {
    const before = this.e2e.discord.channelMessages(g.channels.text).length;
    const response = await this.submitDates(g, panel, dates);
    expect(response.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    await eventually(() => {
      expect(messageText(this.shown(panel))).toContain(
        `The date vote is open in <#${g.channels.text}>.`,
      );
    });
    const poll = this.e2e.discord.channelMessages(g.channels.text)[before];
    if (!poll) throw new Error("the date poll was not posted");
    return poll;
  }

  /**
   * Clicks Propose a date on the date `poll`, types `date` in the modal and
   * submits it; returns the modal and the answer to the submit.
   */
  async proposeDate(member: Member, poll: FakeMessage, date: string) {
    const form = await member.click(
      poll,
      idStarting(this.shown(poll), "hb:date:propose:"),
    );
    const response = await member.submitModal(
      form,
      { [ROUND_IDS.day]: date },
      poll,
    );
    return { form, response };
  }

  /**
   * Clicks Propose a location on the location `poll` and submits `name`
   * with `details`; returns the answer to the submit.
   */
  async proposeLocation(
    member: Member,
    poll: FakeMessage,
    name: string,
    details = "",
  ) {
    const form = await member.click(
      poll,
      idStarting(this.shown(poll), "hb:location:propose:"),
    );
    return member.submitModal(
      form,
      { "hb:location:name": name, "hb:location:details": details },
      poll,
    );
  }

  /** Clicks Vote, picks `labels` and returns the select message. */
  async vote(
    member: Member,
    poll: FakeMessage,
    labels: string[],
  ): Promise<FakeMessage> {
    await member.click(poll, idStarting(this.shown(poll), "hb:poll:vote:"));
    const select = member.lastReply();
    const values = optionValues(select);
    await member.select(
      select,
      idStarting(select, "hb:poll:choose:"),
      labels.map((label) => values[label] ?? `missing ${label}`),
    );
    return this.shown(select);
  }

  /**
   * Closes the open vote named `name` from the panel, confirming, and waits
   * up to `timeout` ms (5 s by default) for the panel to show it closed,
   * which it does once the close steps ran.
   */
  async closeVote(
    owner: Member,
    panel: FakeMessage,
    name: "location vote" | "date vote",
    options: { timeout?: number } = {},
  ): Promise<void> {
    await owner.click(panel, idStarting(this.shown(panel), "hb:poll:close:"));
    expect(messageText(this.shown(panel))).toContain(`Close the ${name} now?`);
    const response = await owner.click(
      panel,
      idStarting(this.shown(panel), "hb:poll:close-confirm:"),
    );
    expect(response.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    await eventually(() => {
      expect(messageText(this.shown(panel))).toContain(`The ${name} is closed`);
    }, options);
  }

  /**
   * Plays a whole round from the panel: a location vote that `location`
   * wins over a second location, then a date vote between `dates` that the
   * date shown as `date` wins. Returns once the date vote is closed.
   */
  async playHike(
    g: TestGuild,
    panel: FakeMessage,
    hike: { location: string; dates: [string, string]; date: string },
  ): Promise<void> {
    const [voter] = g.members as [Member];
    const where = await this.startLocationVote(
      g,
      panel,
      [hike.location, `Not ${hike.location}`].join("\n"),
    );
    await this.vote(voter, where, [hike.location]);
    await this.closeVote(g.owner, panel, "location vote");
    const when = await this.startDateVote(g, panel, hike.dates.join("\n"));
    await this.vote(voter, when, [hike.date]);
    await this.closeVote(g.owner, panel, "date vote");
  }

  /**
   * Finishes the round of the open location `poll`: the guild's last member
   * votes for `location`, the vote closes, the date vote starts with
   * `dates` (one per line) and closes with `date` (its label) the winner.
   */
  async finishRound(
    g: TestGuild,
    panel: FakeMessage,
    poll: FakeMessage,
    location: string,
    dates: string,
    date: string,
  ): Promise<void> {
    const voter = g.members[g.members.length - 1];
    if (!voter) throw new Error("the guild has no members");
    await this.vote(voter, poll, [location]);
    await this.closeVote(g.owner, panel, "location vote");
    const when = await this.startDateVote(g, panel, dates);
    await this.vote(voter, when, [date]);
    await this.closeVote(g.owner, panel, "date vote");
  }

  /**
   * Stores in the guild's object what Start location vote stores before it
   * answers, a round with its open location vote on `labels` proposed by
   * the owner, without the post that follows: the state the object is left
   * in when it restarts between its answer and the post. Writes through the
   * harness's access to the object's SQLite storage.
   */
  async seedUnpostedLocationVote(
    g: TestGuild,
    labels: string[],
  ): Promise<void> {
    const sql = await this.e2e.harness
      .getWorker()
      .getDurableObjectStorage("GUILD_HIKE", { name: g.guildId });
    const owner = g.owner.actor.userId;
    const at = Date.UTC(2026, 10, 18);
    const [round] = await sql.exec<{ id: number }>(
      `INSERT INTO rounds (status, started_by, started_at)
       VALUES ('location_voting', ?, ?) RETURNING id`,
      owner,
      at,
    );
    const [poll] = await sql.exec<{ id: number }>(
      `INSERT INTO polls (round_id, kind, status, opened_by, opened_at)
       VALUES (?, 'location', 'open', ?, ?) RETURNING id`,
      round?.id ?? 0,
      owner,
      at,
    );
    for (const label of labels) {
      await sql.exec(
        `INSERT INTO poll_options
           (poll_id, label, label_key, proposed_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        poll?.id ?? 0,
        label,
        label.toLowerCase(),
        owner,
        at,
      );
    }
  }

  /**
   * Moves the guild `days` days back in time as the weekly schedule's job
   * sees it: every poll's opening time, and when the schedule was turned
   * on. The Worker's clock cannot be moved, so this ages what the job reads
   * instead. Writes through the harness's access to the object's SQLite
   * storage.
   */
  async backdateVotes(g: TestGuild, days: number): Promise<void> {
    const sql = await this.e2e.harness
      .getWorker()
      .getDurableObjectStorage("GUILD_HIKE", { name: g.guildId });
    const ms = days * 86_400_000;
    await sql.exec("UPDATE polls SET opened_at = opened_at - ?", ms);
    await sql.exec(
      "UPDATE guild_settings SET cadence_on_since = cadence_on_since - ?",
      ms,
    );
  }

  /**
   * Moves every date option of the guild from the year `from` to the year
   * `to`, in its value and its label, so hikes played years ahead become
   * past hikes. Give two years with the same calendar (2030 and 2019), so
   * every weekday in the labels stays right. The Worker's clock cannot be
   * moved, and the date vote takes only dates ahead, so this rewrites what
   * the log reads instead, through the harness's access to the object's
   * SQLite storage.
   */
  async moveHikeYears(g: TestGuild, from: string, to: string): Promise<void> {
    const sql = await this.e2e.harness
      .getWorker()
      .getDurableObjectStorage("GUILD_HIKE", { name: g.guildId });
    await sql.exec(
      `UPDATE poll_options
       SET date_value = replace(date_value, ? || '-', ? || '-'),
           label = replace(label, ' ' || ? || ' · ', ' ' || ? || ' · ')
       WHERE date_value IS NOT NULL`,
      from,
      to,
      from,
      to,
    );
  }

  /** Turns the weekly schedule on from Settings, then goes back. */
  async turnScheduleOn(g: TestGuild, panel: FakeMessage): Promise<void> {
    await g.owner.click(panel, ROUND_IDS.settings);
    await g.owner.click(panel, ROUND_IDS.cadence);
    expect(messageText(this.shown(panel))).toContain("The schedule is on.");
    await g.owner.click(panel, ROUND_IDS.back);
  }

  /**
   * Sets the weekly schedule to `weekday` (0 is Sunday) at `time` (`HH:MM`)
   * from Settings, then goes back to the status view.
   */
  async setScheduleTime(
    g: TestGuild,
    panel: FakeMessage,
    weekday: number,
    time: string,
  ): Promise<void> {
    await g.owner.click(panel, ROUND_IDS.settings);
    await g.owner.select(panel, ROUND_IDS.cadenceDay, [String(weekday)]);
    const form = await g.owner.click(panel, ROUND_IDS.cadenceTime);
    await g.owner.submitModal(
      form,
      { [ROUND_IDS.cadenceTimeValue]: time },
      panel,
    );
    expect(messageText(this.shown(panel))).toContain(
      `The schedule's time is ${time}`,
    );
    await g.owner.click(panel, ROUND_IDS.back);
  }

  /** Cancels the active round from the panel, confirming. */
  async cancelRound(owner: Member, panel: FakeMessage): Promise<void> {
    await owner.click(panel, idStarting(this.shown(panel), "hb:round:cancel:"));
    expect(messageText(this.shown(panel))).toContain("Cancel this round?");
    await owner.click(
      panel,
      idStarting(this.shown(panel), "hb:round:cancel-confirm:"),
    );
    await eventually(() => {
      expect(messageText(this.shown(panel))).toContain(
        "The round is cancelled.",
      );
    });
  }
}

/** Checks the member's last reply is an ephemeral V2 message holding `text`. */
export function expectEphemeral(member: Member, text: string): void {
  const reply = member.lastReply();
  expect(reply.ephemeral).toBe(true);
  expect(reply.flags & MessageFlags.IsComponentsV2).toBe(
    MessageFlags.IsComponentsV2,
  );
  expect(messageText(reply)).toContain(text);
}

/** Checks the message has no buttons left. */
export function expectNoButtons(message: FakeMessage): void {
  expect(buttonLabels(message)).toEqual([]);
}
