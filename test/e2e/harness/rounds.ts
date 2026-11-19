/**
 * Steps of a hike round as an admin and members take them, for scenarios
 * that play the location and date votes: a guild set up with its channels,
 * the panel, starting and closing each vote, and voting.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
import type { MapsBucket } from "./maps";
import type { E2E } from "./worker";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

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

/** One option of a seeded vote: for a date, its `YYYY-MM-DD HH:MM`. */
export interface SeededOption {
  label: string;
  details?: string;
  /** The user ids of the members who voted for it. */
  voters?: string[];
  /** For a location: where it is, as if the geocoder had found it there. */
  point?: { lat: number; lon: number };
}

/** A round as `RoundPlayer.seedRound` stores it. */
export interface SeededRound {
  status: "location_voting" | "location_decided" | "date_voting" | "complete";
  /** When it started, in ms since the epoch; each vote lasts a day. */
  startedAt: number;
  locations: SeededOption[];
  /** The winning location's label, once the location vote closed. */
  location?: string;
  dates?: SeededOption[];
  /** The winning date's `YYYY-MM-DD HH:MM`, once the date vote closed. */
  date?: string;
  threadId?: string;
  eventId?: string;
  /**
   * For a complete round: the PNG file, from the repository root, stored in
   * the `MAPS` bucket as the map picture its thread and event show.
   */
  mapPicture?: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * A date option's label as the bot writes it, from its `YYYY-MM-DD HH:MM`:
 * `Sat, 15 Jun 2030 · 11:00`.
 */
export function dateOptionLabel(value: string): string {
  const [day = "", time = ""] = value.split(" ");
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return `${WEEKDAYS[weekday] ?? ""}, ${String(date)} ${MONTHS[month - 1] ?? ""} ${String(year)} · ${time}`;
}

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
   * Stores `round` in the guild's object as the bot would have stored it
   * after members played it that far: its location vote, and from
   * `date_voting` on its date vote, each option with the members who voted
   * for it, the winners once a vote closed, and for a `complete` round its
   * thread and event. The polls' messages are in the text channel, with
   * made-up ids. Nothing is posted, so nothing waits: for the screenshots'
   * seeds, which run outside Vitest and cannot wait with `eventually`.
   * Open the panel first (`setUpPanel`), so the object has its tables.
   * Writes through the harness's access to the object's SQLite storage.
   */
  async seedRound(g: TestGuild, round: SeededRound): Promise<void> {
    const sql = await this.e2e.harness
      .getWorker()
      .getDurableObjectStorage("GUILD_HIKE", { name: g.guildId });
    const owner = g.owner.actor.userId;
    const at = round.startedAt;
    const [row] = await sql.exec<{ id: number }>(
      `INSERT INTO rounds (status, started_by, started_at)
       VALUES (?, ?, ?) RETURNING id`,
      round.status,
      owner,
      at,
    );
    const roundId = row?.id ?? 0;
    const seedPoll = async (
      kind: "location" | "date",
      options: SeededOption[],
      winner: string | undefined,
      openedAt: number,
    ): Promise<number | null> => {
      const [poll] = await sql.exec<{ id: number }>(
        `INSERT INTO polls (round_id, kind, status, channel_id, message_id,
           opened_by, opened_at, closed_by, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        roundId,
        kind,
        winner === undefined ? "open" : "closed",
        g.channels.text,
        `9${g.guildId.slice(1, -3)}${String(roundId * 2 + (kind === "date" ? 1 : 0)).padStart(3, "0")}`,
        owner,
        openedAt,
        winner === undefined ? null : owner,
        winner === undefined ? null : openedAt + 86_400_000,
      );
      const pollId = poll?.id ?? 0;
      let winnerId: number | null = null;
      for (const option of options) {
        const label =
          kind === "date" ? dateOptionLabel(option.label) : option.label;
        const [added] = await sql.exec<{ id: number }>(
          `INSERT INTO poll_options (poll_id, label, label_key, details,
             date_value, proposed_by, created_at, place_lat, place_lon,
             place_name, place_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          pollId,
          label,
          label.toLowerCase(),
          option.details ?? null,
          kind === "date" ? option.label : null,
          owner,
          openedAt,
          option.point?.lat ?? null,
          option.point?.lon ?? null,
          option.point ? label : null,
          option.point ? "found" : null,
        );
        const optionId = added?.id ?? 0;
        if (option.label === winner) winnerId = optionId;
        for (const userId of option.voters ?? []) {
          await sql.exec(
            `INSERT INTO poll_votes (poll_id, option_id, user_id, voted_at)
             VALUES (?, ?, ?, ?)`,
            pollId,
            optionId,
            userId,
            openedAt + 60_000,
          );
        }
      }
      if (winnerId !== null) {
        await sql.exec(
          "UPDATE polls SET winner_option_id = ? WHERE id = ?",
          winnerId,
          pollId,
        );
      }
      return winnerId;
    };
    const location = await seedPoll(
      "location",
      round.locations,
      round.location,
      at,
    );
    await sql.exec(
      "UPDATE rounds SET location_option_id = ? WHERE id = ?",
      location,
      roundId,
    );
    if (round.status !== "date_voting" && round.status !== "complete") return;
    const date = await seedPoll(
      "date",
      round.dates ?? [],
      round.date,
      at + 2 * 86_400_000,
    );
    if (round.status !== "complete") return;
    await sql.exec(
      `UPDATE rounds SET date_option_id = ?, thread_id = ?, event_id = ?,
         ended_by = ?, ended_at = ?
       WHERE id = ?`,
      date,
      round.threadId ?? null,
      round.eventId ?? null,
      owner,
      at + 3 * 86_400_000,
      roundId,
    );
    if (round.mapPicture === undefined) return;
    const key = `pictures/seed/round-${String(roundId)}.png`;
    const env = await this.e2e.harness
      .getWorker<{ MAPS: MapsBucket }>()
      .getEnv();
    await env.MAPS.put(
      key,
      new Uint8Array(await readFile(join(ROOT, round.mapPicture))),
    );
    await sql.exec(
      "UPDATE rounds SET map_picture_key = ? WHERE id = ?",
      key,
      roundId,
    );
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
