/**
 * The round actions called directly, as the web pages and the bot's own
 * schedule call them: no interaction, a real guild object's storage, and
 * `fetch` stubbed as the Discord API. Each action is checked for success,
 * every refusal, and the Discord calls its `work` makes.
 */
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { APIMessageTopLevelComponent } from "discord-api-types/v10";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  POLL_CONTROL_IDS,
  actionButtons,
  loadAdminPanelState,
  renderAdminPanel,
} from "../../src/features/admin-panel";
import { pendingClose } from "../../src/features/close-flow-state";
import { parseCandidateDates } from "../../src/features/date-vote";
import {
  claimHikeDay,
  hikeDayStatus,
  recordHikeDayFailure,
} from "../../src/features/hike-day-state";
import { hikeEventStatus } from "../../src/features/hike-event-state";
import { hikeThreadStatus } from "../../src/features/hike-thread-state";
import { parseInitialLocations } from "../../src/features/location-vote";
import {
  CLOSE_FLOW_DELAY_MS,
  CLOSE_FLOW_JOB,
} from "../../src/features/poll-ui";
import {
  cancelRound,
  cancelRoundCheck,
  closeVote,
  closeVoteCheck,
  dateVoteRefusal,
  defaultDates,
  locationVoteRefusal,
  postVoteMessage,
  retryAnnouncement,
  retryHikeDay,
  retryHikeEvent,
  retryHikeThread,
  startDateVote,
  startLocationVote,
  withdrawDateVote,
  type ActionOutcome,
  type RoundContext,
} from "../../src/features/round-actions";
import {
  VOTE_MESSAGE_CLAIM_MS,
  claimVoteMessage,
  voteMessageStatus,
} from "../../src/features/vote-message-state";
import { GuildConfig } from "../../src/guild/config";
import { scheduledJobs } from "../../src/guild/schedule";
import { defaultDateCandidates, todayIn } from "../../src/polls/dates";
import { PollError } from "../../src/polls/errors";
import { PollStore, type PollView } from "../../src/polls/store";

const OWNER = "400000000000000001";
const MEMBER = "400000000000000002";
const APP = env.DISCORD_APPLICATION_ID;
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const ZONE = "America/Los_Angeles";
const DATES = ["2030-06-08", "2030-06-15"];
const MISSING_PERMISSIONS =
  "Discord answered: Missing Permissions (HTTP 403, code 50013)";

afterEach(() => {
  vi.restoreAllMocks();
});

// The faked Discord API.

interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

/**
 * Stubs `fetch` as the Discord API: every request is recorded and answered
 * with a new id, except those `fail` matches, answered with Missing
 * Permissions.
 */
function fakeDiscord() {
  const sent: Sent[] = [];
  let failing: RegExp | null = null;
  let next = 700000000000000100n;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const path = `${request.method} ${new URL(request.url).pathname.replace(/^.*\/api\/v10/, "")}`;
    const text = await request.text();
    sent.push({
      method: request.method,
      path,
      body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>),
    });
    if (failing?.test(path)) {
      return Response.json(
        { message: "Missing Permissions", code: 50013 },
        { status: 403 },
      );
    }
    next += 1n;
    return Response.json({ id: String(next) });
  });
  return {
    sent,
    fail(match: RegExp | null) {
      failing = match;
    },
    posts(channelId: string) {
      return sent.filter(
        (s) => s.path === `POST /channels/${channelId}/messages`,
      );
    },
  };
}

// Reading messages.

interface Node {
  content?: string;
  custom_id?: string;
  components?: Node[];
  component?: Node;
  accessory?: Node;
}

function flatten(components: readonly Node[]): Node[] {
  return components.flatMap((c) => [
    c,
    ...flatten(c.components ?? []),
    ...flatten(c.component ? [c.component] : []),
    ...flatten(c.accessory ? [c.accessory] : []),
  ]);
}

function text(components: unknown): string {
  return flatten((components ?? []) as Node[])
    .map((c) => c.content ?? "")
    .filter((c) => c !== "")
    .join("\n");
}

function panelText(storage: DurableObjectStorage): string {
  return text(renderAdminPanel(loadAdminPanelState(storage)));
}

function panelButtons(storage: DurableObjectStorage): string[] {
  return actionButtons(loadAdminPanelState(storage)).map((b) => b.custom_id);
}

// The guild object.

function inGuild<T>(
  name: string,
  run: (context: RoundContext, store: PollStore) => T | Promise<T>,
): Promise<T> {
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(name));
  return runInDurableObject(stub, (_i, state) =>
    run(
      { env, storage: state.storage, guildId: name },
      new PollStore(state.storage),
    ),
  );
}

function evict(name: string): Promise<void> {
  return evictDurableObject(
    env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(name)),
  );
}

function configure(storage: DurableObjectStorage): void {
  const config = new GuildConfig(storage);
  config.set("voteChannelId", TEXT);
  config.set("announceChannelId", NEWS);
  config.set("forumChannelId", FORUM);
  config.setTimezone(ZONE);
}

/** Narrows an outcome to its success, failing the test on a refusal. */
function done<T extends ActionOutcome<string, object>>(
  outcome: T,
): Extract<T, { ok: true }> {
  if (!outcome.ok) throw new Error(`refused: ${outcome.message}`);
  return outcome as Extract<T, { ok: true }>;
}

/** A configured guild whose location vote is open, its message posted. */
function locationVoting(
  context: RoundContext,
  labels = ["Ridge Trail", "Lake Loop"],
): PollView {
  configure(context.storage);
  const store = new PollStore(context.storage);
  const poll = store.startRound(
    OWNER,
    labels.map((label) => ({ label, proposedBy: OWNER })),
  ).locationPoll;
  if (poll === null) throw new Error("no location poll");
  store.setPollMessage(poll.id, TEXT, "700000000000000001");
  return poll;
}

/** A configured guild whose location is decided as Ridge Trail. */
function decided(context: RoundContext): number {
  const poll = locationVoting(context, ["Ridge Trail"]);
  new PollStore(context.storage).closePoll(poll.id, OWNER);
  return poll.roundId;
}

/** A configured guild whose date vote is open on `dates`, message posted. */
function dateVoting(context: RoundContext, dates = DATES): PollView {
  const roundId = decided(context);
  const store = new PollStore(context.storage);
  const poll = store.startDatePoll(roundId, OWNER, dates);
  store.setPollMessage(poll.id, TEXT, "700000000000000002");
  return poll;
}

/**
 * A guild whose last round is complete: its date vote closed through
 * `closeVote` with `failing` refused by Discord during the close flow.
 */
async function completed(
  context: RoundContext,
  discord: ReturnType<typeof fakeDiscord>,
  failing: RegExp,
  dates = DATES,
): Promise<PollView> {
  const poll = dateVoting(context, dates);
  new PollStore(context.storage).setVotes(poll.id, MEMBER, [
    poll.options[0]?.id ?? 0,
  ]);
  discord.fail(failing);
  await done(await closeVote(context, OWNER, { pollId: poll.id })).work();
  discord.fail(null);
  discord.sent.length = 0;
  return poll;
}

describe("startLocationVote", () => {
  it("starts the round, then posts and records the poll message", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-location-start", async (context, store) => {
      configure(context.storage);
      const started = done(
        startLocationVote(context, OWNER, {
          labels: ["Ridge Trail", "", " Lake Loop ", "ridge trail"],
        }),
      );
      expect(started.round).toMatchObject({
        status: "location_voting",
        startedBy: OWNER,
      });
      expect(started.poll.options.map((o) => [o.label, o.proposedBy])).toEqual([
        ["Ridge Trail", OWNER],
        ["Lake Loop", OWNER],
      ]);
      // Stored before the work runs; nothing posted yet.
      expect(store.getActiveRound()?.id).toBe(started.round.id);
      expect(discord.sent).toEqual([]);

      const notes = await started.work();
      expect(notes).toEqual([`The location vote is open in <#${TEXT}>.`]);
      expect(discord.posts(TEXT)).toHaveLength(1);
      const body = discord.posts(TEXT)[0]?.body;
      expect(text(body?.components)).toContain("## Where should we hike?");
      expect(text(body?.components)).toContain(`Proposed by <@${OWNER}>`);
      const poll = store.getPoll(started.poll.id);
      expect(poll?.channelId).toBe(TEXT);
      expect(poll?.messageId).not.toBeNull();
    });
  });

  it("starts with no locations", async () => {
    fakeDiscord();
    await inGuild("actions-location-empty", (context) => {
      configure(context.storage);
      const started = done(startLocationVote(context, OWNER, { labels: [] }));
      expect(started.poll.options).toEqual([]);
    });
  });

  it("refuses labels the start modal refuses, with its sentence", async () => {
    await inGuild("actions-location-invalid", (context, store) => {
      configure(context.storage);
      const labels = ["Ridge Trail", "L".repeat(81)];
      const parsed = parseInitialLocations(labels.join("\n"));
      expect(startLocationVote(context, OWNER, { labels })).toEqual({
        ok: false,
        code: "invalid_labels",
        message: parsed.ok ? "" : parsed.error,
      });
      expect(store.getActiveRound()).toBeNull();
    });
  });

  it("refuses before setup is complete", async () => {
    await inGuild("actions-location-setup", (context, store) => {
      new GuildConfig(context.storage).set("voteChannelId", TEXT);
      const refusal = {
        ok: false,
        code: "setup_incomplete",
        message:
          "Set the announcements channel and hike threads channel under Settings before starting a vote.",
      };
      expect(startLocationVote(context, OWNER, { labels: [] })).toEqual(
        refusal,
      );
      expect(locationVoteRefusal(context)).toEqual(refusal);
      expect(store.getActiveRound()).toBeNull();
    });
  });

  it("refuses a location resting after a recent hike", async () => {
    await inGuild("actions-location-resting", (context, store) => {
      const roundId = decided(context);
      store.closePoll(store.startDatePoll(roundId, OWNER, DATES).id, OWNER);
      const outcome = startLocationVote(context, OWNER, {
        labels: ["Lake Loop", "Ridge Trail"],
      });
      expect(outcome).toMatchObject({ ok: false, code: "resting" });
      expect(outcome.ok ? "" : outcome.message).toMatch(
        /^Nothing was started\. Remove this location and try again:\n- .*Ridge Trail/,
      );
      expect(store.getActiveRound()).toBeNull();
    });
  });

  it("refuses while a round is active", async () => {
    await inGuild("actions-location-active", (context) => {
      locationVoting(context);
      const refusal = {
        ok: false,
        code: "round_active",
        message: "A round is already active.",
      };
      expect(startLocationVote(context, OWNER, { labels: [] })).toEqual(
        refusal,
      );
      expect(locationVoteRefusal(context)).toEqual(refusal);
    });
  });

  it("takes the round back when Discord refuses the post", async () => {
    const discord = fakeDiscord();
    discord.fail(/POST \/channels\/.*\/messages/);
    await inGuild("actions-location-refused", async (context, store) => {
      configure(context.storage);
      const started = done(
        startLocationVote(context, OWNER, { labels: ["Ridge Trail"] }),
      );
      expect(await started.work()).toEqual([
        `Could not post the location vote in <#${TEXT}>: ${MISSING_PERMISSIONS}. No round was started; check the bot's permissions in that channel and try again.`,
      ]);
      expect(store.getActiveRound()).toBeNull();
      expect(store.getRound(started.round.id)?.status).toBe("cancelled");
    });
  });

  it("records the application as starter and names it hikebot", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-location-app", async (context, store) => {
      configure(context.storage);
      const started = done(
        startLocationVote(context, APP, { labels: ["Ridge Trail"] }),
      );
      await started.work();
      expect(store.getRound(started.round.id)?.startedBy).toBe(APP);
      expect(store.getPoll(started.poll.id)?.openedBy).toBe(APP);
      expect(started.poll.options[0]?.proposedBy).toBe(APP);
      const shown = text(discord.posts(TEXT)[0]?.body.components);
      expect(shown).toContain("Proposed by hikebot");
      expect(shown).not.toContain(`<@${APP}>`);
      expect(panelText(context.storage)).not.toContain(`<@${APP}>`);
    });
  });
});

describe("closeVote", () => {
  it("closes the poll and records its close work before it returns, then runs the close flow", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-close", async (context, store) => {
      const poll = locationVoting(context);
      store.setVotes(poll.id, MEMBER, [poll.options[1]?.id ?? 0]);
      expect(closeVoteCheck(context, poll.id)).toMatchObject({ ok: true });
      const before = store.now();
      const closed = done(await closeVote(context, OWNER, { pollId: poll.id }));
      expect(closed.poll).toMatchObject({
        status: "closed",
        closedBy: OWNER,
        winnerOptionId: poll.options[1]?.id,
      });
      expect(store.getActiveRound()?.status).toBe("location_decided");
      expect(pendingClose(context.storage, poll.id)).toMatchObject({
        guildId: "actions-close",
        timeZone: ZONE,
      });
      expect(
        (await scheduledJobs(context.storage)).get(CLOSE_FLOW_JOB),
      ).toBeGreaterThanOrEqual(before + CLOSE_FLOW_DELAY_MS);
      expect(discord.sent).toEqual([]);

      expect(await closed.work()).toEqual([
        "The location vote is closed: **Lake Loop** won with 1 vote.",
      ]);
      expect(discord.sent.map((s) => s.path)).toEqual([
        `PATCH /channels/${TEXT}/messages/700000000000000001`,
        `POST /channels/${NEWS}/messages`,
      ]);
      expect(pendingClose(context.storage, poll.id)).toBeNull();
    });
  });

  it("refuses a vote that is not open", async () => {
    await inGuild("actions-close-not-open", async (context, store) => {
      const poll = locationVoting(context);
      store.cancelRound(poll.roundId, OWNER);
      const refusal = {
        ok: false,
        code: "not_open",
        message: "That vote is no longer open.",
      };
      expect(await closeVote(context, OWNER, { pollId: poll.id })).toEqual(
        refusal,
      );
      expect(await closeVote(context, OWNER, { pollId: 999 })).toEqual(refusal);
      expect(closeVoteCheck(context, poll.id)).toEqual(refusal);
      expect(pendingClose(context.storage, poll.id)).toBeNull();
    });
  });

  it("refuses a vote without options", async () => {
    await inGuild("actions-close-empty", async (context, store) => {
      const poll = locationVoting(context, []);
      const refusal = {
        ok: false,
        code: "no_options",
        message:
          "The location vote has no locations yet, so it cannot be closed. Wait for a proposal, or cancel the round.",
      };
      expect(await closeVote(context, OWNER, { pollId: poll.id })).toEqual(
        refusal,
      );
      expect(closeVoteCheck(context, poll.id)).toEqual(refusal);
      expect(store.getPoll(poll.id)?.status).toBe("open");
    });
  });

  it("records the application as closer, and no message mentions it", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-close-app", async (context, store) => {
      const poll = locationVoting(context);
      await done(await closeVote(context, APP, { pollId: poll.id })).work();
      expect(store.getPoll(poll.id)?.closedBy).toBe(APP);
      const announcement = text(discord.posts(NEWS)[0]?.body.components);
      expect(announcement).toContain("## Hike location decided");
      expect(announcement).not.toContain(`<@${APP}>`);
      expect(panelText(context.storage)).not.toContain(`<@${APP}>`);
    });
  });
});

describe("startDateVote", () => {
  it("opens the date vote on the given dates, then posts its message", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-date-start", async (context, store) => {
      decided(context);
      expect(dateVoteRefusal(context)).toBeNull();
      const started = done(
        startDateVote(context, OWNER, { dates: ["2030-06-15", "2030-06-08"] }),
      );
      expect(started.round.status).toBe("date_voting");
      expect(started.poll).toMatchObject({ kind: "date", openedBy: OWNER });
      expect(started.poll.options.map((o) => o.dateValue)).toEqual([
        "2030-06-08 11:00",
        "2030-06-15 11:00",
      ]);
      expect(await started.work()).toEqual([
        `The date vote is open in <#${TEXT}>.`,
      ]);
      expect(discord.posts(TEXT)).toHaveLength(1);
      expect(text(discord.posts(TEXT)[0]?.body.components)).toContain(
        "## When should we hike Ridge Trail?",
      );
      expect(store.getPoll(started.poll.id)?.messageId).not.toBeNull();
    });
  });

  it("opens it on the default dates when none are given", async () => {
    fakeDiscord();
    await inGuild("actions-date-default", (context, store) => {
      decided(context);
      const today = todayIn(ZONE, store.now());
      expect(defaultDates(context)).toEqual(defaultDateCandidates(today));
      const started = done(startDateVote(context, OWNER));
      const expected = parseCandidateDates(
        defaultDateCandidates(today).join("\n"),
        store.now(),
        ZONE,
      );
      expect(started.poll.options.map((o) => o.dateValue)).toEqual(
        expected.ok ? expected.dates : [],
      );
    });
  });

  it("refuses dates the start modal refuses, with its sentence", async () => {
    await inGuild("actions-date-invalid", (context, store) => {
      decided(context);
      const dates = ["2030-06-08", "next saturday"];
      const parsed = parseCandidateDates(dates.join("\n"), store.now(), ZONE);
      expect(startDateVote(context, OWNER, { dates })).toEqual({
        ok: false,
        code: "invalid_dates",
        message: parsed.ok ? "" : parsed.error,
      });
      expect(store.getActiveRound()?.status).toBe("location_decided");
    });
  });

  it("refuses before setup is complete", async () => {
    await inGuild("actions-date-setup", (context) => {
      decided(context);
      new GuildConfig(context.storage).set("forumChannelId", null);
      const refusal = {
        ok: false,
        code: "setup_incomplete",
        message:
          "Set the hike threads channel under Settings before starting a vote.",
      };
      expect(startDateVote(context, OWNER, { dates: DATES })).toEqual(refusal);
      expect(dateVoteRefusal(context)).toEqual(refusal);
    });
  });

  it("refuses until the location is decided", async () => {
    await inGuild("actions-date-undecided", (context) => {
      locationVoting(context);
      const refusal = {
        ok: false,
        code: "not_decided",
        message: "The date vote starts once the location is decided.",
      };
      expect(startDateVote(context, OWNER, { dates: DATES })).toEqual(refusal);
      expect(dateVoteRefusal(context)).toEqual(refusal);
    });
  });

  it("refuses with the poll core's sentence when it refuses the dates", async () => {
    class Refusing extends PollStore {
      override startDatePoll(): PollView {
        throw new PollError("invalid_state", "Not now.");
      }
    }
    await inGuild("actions-date-refused", (context) => {
      decided(context);
      expect(
        startDateVote(
          { ...context, store: new Refusing(context.storage) },
          OWNER,
          { dates: DATES },
        ),
      ).toEqual({ ok: false, code: "refused", message: "Not now." });
    });
  });

  it("withdraws the date vote when Discord refuses the post", async () => {
    const discord = fakeDiscord();
    discord.fail(/POST \/channels\/.*\/messages/);
    await inGuild("actions-date-post-refused", async (context, store) => {
      decided(context);
      const started = done(startDateVote(context, OWNER, { dates: DATES }));
      expect(await started.work()).toEqual([
        `Could not post the date vote in <#${TEXT}>: ${MISSING_PERMISSIONS}. The date vote was not started; check the bot's permissions in that channel and try again.`,
      ]);
      expect(store.getActiveRound()?.status).toBe("location_decided");
      expect(store.getPoll(started.poll.id)).toBeNull();
    });
  });

  it("records the application as opener", async () => {
    fakeDiscord();
    await inGuild("actions-date-app", async (context, store) => {
      decided(context);
      const started = done(startDateVote(context, APP, { dates: DATES }));
      await started.work();
      expect(store.getPoll(started.poll.id)?.openedBy).toBe(APP);
    });
  });
});

describe("withdrawDateVote", () => {
  it("takes the date vote back and marks its message cancelled", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-withdraw", async (context, store) => {
      const poll = dateVoting(context);
      const withdrawn = done(
        withdrawDateVote(context, OWNER, { pollId: poll.id }),
      );
      expect(withdrawn.round.status).toBe("location_decided");
      expect(store.getPoll(poll.id)).toBeNull();
      expect(dateVoteRefusal(context)).toBeNull();
      expect(await withdrawn.work()).toEqual(["The date vote is withdrawn."]);
      expect(discord.sent.map((s) => s.path)).toEqual([
        `PATCH /channels/${TEXT}/messages/700000000000000002`,
      ]);
      const shown = text(discord.sent[0]?.body.components);
      expect(shown).toContain("(cancelled)");
      expect(shown).toContain("This vote was cancelled.");
    });
  });

  it("refuses when no date vote is open", async () => {
    await inGuild("actions-withdraw-none", (context, store) => {
      const poll = dateVoting(context);
      store.cancelRound(poll.roundId, OWNER);
      const refusal = {
        ok: false,
        code: "not_open",
        message: "There is no open date vote to withdraw.",
      };
      expect(withdrawDateVote(context, OWNER, { pollId: poll.id })).toEqual(
        refusal,
      );
      expect(withdrawDateVote(context, OWNER, { pollId: 999 })).toEqual(
        refusal,
      );
    });
  });
});

describe("cancelRound", () => {
  it("cancels the round and marks the open vote's message cancelled", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-cancel", async (context, store) => {
      const poll = locationVoting(context);
      expect(cancelRoundCheck(context, poll.roundId)).toMatchObject({
        ok: true,
      });
      const cancelled = done(
        cancelRound(context, APP, { roundId: poll.roundId }),
      );
      expect(cancelled.round).toMatchObject({
        status: "cancelled",
        endedBy: APP,
      });
      expect(store.getActiveRound()).toBeNull();
      expect(await cancelled.work()).toEqual(["The round is cancelled."]);
      expect(discord.sent.map((s) => s.path)).toEqual([
        `PATCH /channels/${TEXT}/messages/700000000000000001`,
      ]);
      expect(text(discord.sent[0]?.body.components)).toContain(
        "This vote was cancelled.",
      );
    });
  });

  it("names a message it could not mark", async () => {
    const discord = fakeDiscord();
    discord.fail(/PATCH/);
    await inGuild("actions-cancel-refused", async (context) => {
      const poll = locationVoting(context);
      const cancelled = done(
        cancelRound(context, OWNER, { roundId: poll.roundId }),
      );
      expect(await cancelled.work()).toEqual([
        "The round is cancelled.",
        `Could not mark the poll message in <#${TEXT}> as cancelled: ${MISSING_PERMISSIONS}.`,
      ]);
    });
  });

  it("refuses a round that has ended", async () => {
    await inGuild("actions-cancel-ended", (context, store) => {
      const poll = locationVoting(context);
      store.cancelRound(poll.roundId, OWNER);
      const refusal = {
        ok: false,
        code: "ended",
        message: "That round has already ended.",
      };
      expect(cancelRound(context, OWNER, { roundId: poll.roundId })).toEqual(
        refusal,
      );
      expect(cancelRound(context, OWNER, { roundId: 999 })).toEqual(refusal);
      expect(cancelRoundCheck(context, poll.roundId)).toEqual(refusal);
    });
  });
});

describe("postVoteMessage", () => {
  /** A guild whose location vote started without its work ever running. */
  function unposted(context: RoundContext): PollView {
    configure(context.storage);
    return done(startLocationVote(context, OWNER, { labels: ["Ridge Trail"] }))
      .poll;
  }

  it("is offered on the panel for an open poll without a message, and posts one", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-post", async (context, store) => {
      const poll = unposted(context);
      expect(panelButtons(context.storage)).toContain(
        POLL_CONTROL_IDS.postVoteMessage(poll.id),
      );
      expect(panelText(context.storage)).toContain(
        "**The location vote is open**, but its message has not been posted. Click Post vote message to post it.",
      );
      const posting = done(
        postVoteMessage(context, OWNER, { pollId: poll.id }),
      );
      expect(panelText(context.storage)).toContain(
        "**The location vote is open**; its message is being posted.",
      );
      expect(panelButtons(context.storage)).not.toContain(
        POLL_CONTROL_IDS.postVoteMessage(poll.id),
      );
      expect(await posting.work()).toEqual([
        `The location vote is open in <#${TEXT}>.`,
      ]);
      expect(discord.posts(TEXT)).toHaveLength(1);
      expect(store.getPoll(poll.id)?.channelId).toBe(TEXT);
      expect(panelText(context.storage)).toContain(
        `**The location vote is open** in <#${TEXT}>.`,
      );
      expect(panelButtons(context.storage)).not.toContain(
        POLL_CONTROL_IDS.postVoteMessage(poll.id),
      );
    });
  });

  it("posts one message when pressed twice", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-post-twice", async (context) => {
      const poll = unposted(context);
      const first = postVoteMessage(context, OWNER, { pollId: poll.id });
      const second = postVoteMessage(context, OWNER, { pollId: poll.id });
      expect(second).toEqual({
        ok: false,
        code: "posting",
        message: "The location vote's message is being posted.",
      });
      await done(first).work();
      expect(postVoteMessage(context, OWNER, { pollId: poll.id })).toEqual({
        ok: false,
        code: "already_posted",
        message: `The location vote's message is already posted in <#${TEXT}>.`,
      });
      expect(discord.posts(TEXT)).toHaveLength(1);
    });
  });

  it("posts nothing after the start's own work posted the message", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-post-after-start", async (context) => {
      configure(context.storage);
      const started = done(
        startLocationVote(context, OWNER, { labels: ["Ridge Trail"] }),
      );
      await started.work();
      expect(
        postVoteMessage(context, OWNER, { pollId: started.poll.id }),
      ).toMatchObject({ ok: false, code: "already_posted" });
      expect(discord.posts(TEXT)).toHaveLength(1);
    });
  });

  it("leaves the start's own work nothing to post once pressed", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-post-before-start-work", async (context) => {
      configure(context.storage);
      const started = done(
        startLocationVote(context, OWNER, { labels: ["Ridge Trail"] }),
      );
      const pressed = done(
        postVoteMessage(context, OWNER, { pollId: started.poll.id }),
      );
      expect(await started.work()).toEqual([
        "The location vote's message is being posted.",
      ]);
      await pressed.work();
      expect(discord.posts(TEXT)).toHaveLength(1);
    });
  });

  it("is offered again, without warning, after the object restarted before the start's work", async () => {
    const guild = "actions-post-restart";
    const discord = fakeDiscord();
    const pollId = await inGuild(guild, (context) => unposted(context).id);
    await evict(guild);
    await inGuild(guild, async (context, store) => {
      expect(
        voteMessageStatus(
          context.storage,
          store.getPoll(pollId) as PollView,
          store.now(),
        ),
      ).toEqual({ state: "missing" });
      await done(postVoteMessage(context, OWNER, { pollId })).work();
      expect(discord.posts(TEXT)).toHaveLength(1);
    });
  });

  it("shows a post cut off by a restart as not confirmed, and posts once", async () => {
    const guild = "actions-post-cut-off";
    const discord = fakeDiscord();
    const pollId = await inGuild(guild, (context, store) => {
      const poll = unposted(context);
      expect(claimVoteMessage(context.storage, poll, store.now())).toBe(true);
      return poll.id;
    });
    await evict(guild);
    await inGuild(guild, async (context) => {
      expect(panelText(context.storage)).toContain(
        "**The location vote is open**, but its message is not confirmed: posting it was cut off, so it may or may not have been posted. Check the voting channel, and click Post vote message only if it is missing.",
      );
      expect(panelButtons(context.storage)).toContain(
        POLL_CONTROL_IDS.postVoteMessage(pollId),
      );
      const pressed = done(postVoteMessage(context, OWNER, { pollId }));
      expect(postVoteMessage(context, OWNER, { pollId })).toMatchObject({
        code: "posting",
      });
      await pressed.work();
      expect(discord.posts(TEXT)).toHaveLength(1);
    });
  });

  it("treats a claim older than a minute as cut off", async () => {
    await inGuild("actions-post-stale", (context, store) => {
      const poll = unposted(context);
      const at = store.now();
      claimVoteMessage(context.storage, poll, at);
      expect(voteMessageStatus(context.storage, poll, at + 1).state).toBe(
        "posting",
      );
      expect(
        voteMessageStatus(context.storage, poll, at + VOTE_MESSAGE_CLAIM_MS)
          .state,
      ).toBe("unconfirmed");
    });
  });

  it("keeps the round when Discord refuses, and shows why with the button", async () => {
    const discord = fakeDiscord();
    discord.fail(/POST \/channels\/.*\/messages/);
    await inGuild("actions-post-refused", async (context, store) => {
      const poll = unposted(context);
      const reason = `Could not post the location vote in <#${TEXT}>: ${MISSING_PERMISSIONS}. Check that the bot can post there, then click Post vote message.`;
      expect(
        await done(postVoteMessage(context, OWNER, { pollId: poll.id })).work(),
      ).toEqual([reason]);
      expect(store.getActiveRound()?.status).toBe("location_voting");
      expect(panelText(context.storage)).toContain(
        `**The location vote is open**, but its message has not been posted. ${reason}`,
      );
      expect(panelButtons(context.storage)).toContain(
        POLL_CONTROL_IDS.postVoteMessage(poll.id),
      );
      discord.fail(null);
      await done(postVoteMessage(context, OWNER, { pollId: poll.id })).work();
      expect(store.getPoll(poll.id)?.messageId).not.toBeNull();
      expect(panelText(context.storage)).not.toContain("Could not post");
    });
  });

  it("marks a message posted after the round was cancelled", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-post-cancelled", async (context, store) => {
      const poll = unposted(context);
      const pressed = done(
        postVoteMessage(context, OWNER, { pollId: poll.id }),
      );
      store.cancelRound(poll.roundId, OWNER);
      expect(await pressed.work()).toEqual([
        `The location vote was posted in <#${TEXT}>, but the round had been cancelled meanwhile, so the message now shows it as cancelled.`,
      ]);
      expect(discord.sent.map((s) => s.method)).toEqual(["POST", "PATCH"]);
    });
  });

  it("refuses a vote that is not open, or without a voting channel", async () => {
    await inGuild("actions-post-refusals", (context, store) => {
      const poll = unposted(context);
      new GuildConfig(context.storage).set("voteChannelId", null);
      expect(postVoteMessage(context, OWNER, { pollId: poll.id })).toEqual({
        ok: false,
        code: "no_channel",
        message:
          "No voting channel is set. Pick one under Settings, then click Post vote message.",
      });
      store.cancelRound(poll.roundId, OWNER);
      expect(postVoteMessage(context, OWNER, { pollId: poll.id })).toEqual({
        ok: false,
        code: "not_open",
        message: "That vote is no longer open.",
      });
    });
  });

  it("posts the date vote's message too", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-post-date", async (context) => {
      decided(context);
      const poll = done(startDateVote(context, OWNER, { dates: DATES })).poll;
      expect(
        await done(postVoteMessage(context, OWNER, { pollId: poll.id })).work(),
      ).toEqual([`The date vote is open in <#${TEXT}>.`]);
      expect(discord.posts(TEXT)).toHaveLength(1);
    });
  });
});

describe("retryHikeThread", () => {
  it("creates the thread Discord refused at the close, once", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-thread", async (context, store) => {
      const poll = await completed(
        context,
        discord,
        /\/channels\/\d+\/threads/,
      );
      const round = store.getLastRound();
      expect(round?.threadId).toBeNull();
      const retried = done(
        retryHikeThread(context, OWNER, { roundId: poll.roundId }),
      );
      expect(
        retryHikeThread(context, OWNER, { roundId: poll.roundId }),
      ).toEqual({
        ok: false,
        code: "creating",
        message: "The hike thread is being created.",
      });
      const [note] = await retried.work();
      const threadId = store.getLastRound()?.threadId ?? "";
      expect(note).toBe(`The hike thread is open: <#${threadId}>.`);
      expect(
        discord.sent.filter((s) => s.path.endsWith("/threads")),
      ).toHaveLength(1);
      expect(
        retryHikeThread(context, OWNER, { roundId: poll.roundId }),
      ).toEqual({
        ok: false,
        code: "created",
        message: `The hike thread already exists: <#${threadId}>.`,
      });
    });
  });

  it("refuses a round that is not the last completed one", async () => {
    await inGuild("actions-thread-not-last", (context) => {
      const poll = dateVoting(context);
      expect(
        retryHikeThread(context, OWNER, { roundId: poll.roundId }),
      ).toEqual({
        ok: false,
        code: "not_last",
        message:
          "That hike is no longer the last one, so its thread is not created from here.",
      });
    });
  });

  it("names the application's locations hikebot in the thread", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-thread-app", async (context, store) => {
      configure(context.storage);
      const round = store.startRound(APP, [
        { label: "Ridge Trail", proposedBy: APP },
      ]);
      store.closePoll(round.locationPoll?.id ?? 0, APP);
      const date = done(startDateVote(context, APP, { dates: DATES })).poll;
      discord.fail(/\/threads/);
      await done(await closeVote(context, APP, { pollId: date.id })).work();
      discord.fail(null);
      await done(retryHikeThread(context, APP, { roundId: round.id })).work();
      const thread = discord.sent.filter((s) => s.path.endsWith("/threads"));
      const message = (thread.at(-1)?.body.message ?? {}) as {
        components?: APIMessageTopLevelComponent[];
      };
      expect(text(message.components)).toContain("Proposed by hikebot");
      expect(JSON.stringify(discord.sent)).not.toContain(`<@${APP}>`);
      expect(panelText(context.storage)).not.toContain(`<@${APP}>`);
    });
  });
});

describe("retryHikeEvent", () => {
  it("creates the event Discord refused at the close, once", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-event", async (context, store) => {
      const poll = await completed(context, discord, /scheduled-events/);
      const retried = done(
        retryHikeEvent(context, OWNER, { roundId: poll.roundId }),
      );
      expect(retryHikeEvent(context, OWNER, { roundId: poll.roundId })).toEqual(
        {
          ok: false,
          code: "creating",
          message: "The hike event is being created.",
        },
      );
      const [note] = await retried.work();
      const eventId = store.getLastRound()?.eventId ?? "";
      const url = `https://discord.com/events/actions-event/${eventId}`;
      expect(note).toBe(`The hike event is created: ${url}`);
      expect(
        discord.sent.filter((s) => s.path.endsWith("/scheduled-events")),
      ).toHaveLength(1);
      expect(retryHikeEvent(context, OWNER, { roundId: poll.roundId })).toEqual(
        {
          ok: false,
          code: "created",
          message: `The hike event already exists: ${url}`,
        },
      );
    });
  });

  it("refuses a hike whose start has passed", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-event-past", async (context, store) => {
      const today = todayIn(ZONE, store.now());
      const poll = await completed(context, discord, /^$/, [
        `${today} 00:00`,
        "2030-06-15",
      ]);
      const round = store.getLastRound();
      expect(
        round && hikeEventStatus(context.storage, round, store.now(), ZONE),
      ).toEqual({ state: "past" });
      expect(retryHikeEvent(context, OWNER, { roundId: poll.roundId })).toEqual(
        {
          ok: false,
          code: "past",
          message: "The hike's start time has passed, so no event was created.",
        },
      );
    });
  });

  it("refuses a round that is not the last completed one", async () => {
    await inGuild("actions-event-not-last", (context) => {
      const poll = dateVoting(context);
      expect(retryHikeEvent(context, OWNER, { roundId: poll.roundId })).toEqual(
        {
          ok: false,
          code: "not_last",
          message:
            "That hike is no longer the last one, so its event is not created from here.",
        },
      );
    });
  });
});

describe("retryHikeDay", () => {
  it("posts a hike-day announcement that failed, once", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-hike-day", async (context, store) => {
      const poll = await completed(context, discord, /^$/);
      const round = store.getLastRound();
      if (round === null) throw new Error("no round");
      expect(hikeDayStatus(context.storage, round, store.now())).toEqual({
        state: "planned",
      });
      expect(retryHikeDay(context, OWNER, { roundId: poll.roundId })).toEqual({
        ok: false,
        code: "not_due",
        message: "The hike-day announcement is not due, so it was not posted.",
      });
      recordHikeDayFailure(
        context.storage,
        round.id,
        "actions-hike-day",
        "Discord said no.",
      );
      const retried = done(
        retryHikeDay(context, OWNER, { roundId: poll.roundId }),
      );
      expect(retryHikeDay(context, OWNER, { roundId: poll.roundId })).toEqual({
        ok: false,
        code: "posting",
        message: "The hike-day announcement is being posted.",
      });
      expect(await retried.work()).toEqual([
        `The hike-day announcement is posted in <#${NEWS}>.`,
      ]);
      const posts = discord.posts(NEWS);
      expect(posts).toHaveLength(1);
      expect(text(posts[0]?.body.components)).toContain(
        "## Hike today: Ridge Trail",
      );
      expect(retryHikeDay(context, OWNER, { roundId: poll.roundId })).toEqual({
        ok: false,
        code: "posted",
        message: `The hike-day announcement is already posted in <#${NEWS}>.`,
      });
    });
  });

  it("refuses a hike that is over", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-hike-day-over", async (context, store) => {
      const poll = await completed(context, discord, /^$/);
      const round = store.getLastRound();
      if (round === null) throw new Error("no round");
      claimHikeDay(context.storage, round, "actions-hike-day-over", 0);
      // 15:00 in Los Angeles on Sat 8 Jun 2030, when the 11:00 hike ends.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.UTC(2030, 5, 8, 22));
      try {
        expect(retryHikeDay(context, OWNER, { roundId: poll.roundId })).toEqual(
          {
            ok: false,
            code: "over",
            message:
              "The hike is over, so its hike-day announcement is not posted.",
          },
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("refuses a round that is not the last completed one", async () => {
    await inGuild("actions-hike-day-not-last", (context) => {
      const poll = dateVoting(context);
      expect(retryHikeDay(context, OWNER, { roundId: poll.roundId })).toEqual({
        ok: false,
        code: "not_last",
        message:
          "That hike is no longer the last one, so its hike-day announcement is not posted from here.",
      });
    });
  });
});

describe("retryAnnouncement", () => {
  it("posts the announcement Discord refused at the close, once", async () => {
    const discord = fakeDiscord();
    await inGuild("actions-announce", async (context, store) => {
      const poll = await completed(
        context,
        discord,
        new RegExp(`POST /channels/${NEWS}/messages`),
      );
      const round = store.getLastRound();
      expect(
        round && hikeThreadStatus(context.storage, round, store.now()).state,
      ).toBe("created");
      const retried = done(
        retryAnnouncement(context, OWNER, { pollId: poll.id }),
      );
      expect(retryAnnouncement(context, OWNER, { pollId: poll.id })).toEqual({
        ok: false,
        code: "posting",
        message: "The date vote's announcement is being posted.",
      });
      expect(await retried.work()).toEqual([
        `The date vote's result is announced in <#${NEWS}>.`,
      ]);
      expect(discord.posts(NEWS)).toHaveLength(1);
      expect(text(discord.posts(NEWS)[0]?.body.components)).toContain(
        "## Hike planned",
      );
      expect(retryAnnouncement(context, OWNER, { pollId: poll.id })).toEqual({
        ok: false,
        code: "posted",
        message: "The date vote's announcement is already posted.",
      });
    });
  });

  it("refuses a vote outside the last round", async () => {
    await inGuild("actions-announce-not-last", (context) => {
      const poll = dateVoting(context);
      expect(retryAnnouncement(context, OWNER, { pollId: poll.id })).toEqual({
        ok: false,
        code: "not_last",
        message:
          "That vote is no longer in the last round, so its announcement is not posted from here.",
      });
    });
  });
});
