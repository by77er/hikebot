/**
 * The admin controls of a server's web page, inside a real guild object
 * with `fetch` stubbed as the Discord API: the controls `webAdminActions`
 * offers in each state against the panel's own (`actionButtons`), the
 * view's admin section (`adminSection`), and `runWebAdminAction` running
 * each control as its actor, with the panel's notes and refusals, the
 * retries it offers, and the answer it gives when the Discord work takes
 * longer than it waits.
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actionButtons,
  loadAdminPanelState,
  renderAdminPanel,
} from "../../src/features/admin-panel";
import {
  DATE_POLL,
  parseCandidateDates,
  START_DATES_FIELD,
} from "../../src/features/date-vote";
import {
  LOCATION_POLL,
  parseInitialLocations,
  START_LOCATIONS_FIELD,
} from "../../src/features/location-vote";
import {
  CANCEL_QUESTION,
  closeQuestion,
  type PollWording,
} from "../../src/features/poll-ui";
import {
  closeVote,
  defaultDates,
  locationVoteRefusal,
  type ActionOutcome,
  type RoundContext,
} from "../../src/features/round-actions";
import {
  adminSection,
  runWebAdminAction,
  webAdminActions,
  WITHDRAW_QUESTION,
  type WebAdminAction,
  type WebAdminOutcome,
} from "../../src/features/web-admin";
import { GuildConfig } from "../../src/guild/config";
import type { WebViewSource } from "../../src/guild/web-view";
import { PollStore, type PollView } from "../../src/polls/store";

const OWNER = "400000000000009501";
const MEMBER = "400000000000009502";
const ACTOR = "400000000000009503";
const TEXT = "300000000000009501";
const NEWS = "300000000000009502";
const FORUM = "300000000000009503";
const ZONE = "America/Los_Angeles";
const DATES = ["2030-06-08", "2030-06-15"];

afterEach(() => {
  vi.restoreAllMocks();
});

// The faked Discord API.

interface Sent {
  method: string;
  path: string;
}

/**
 * Stubs `fetch` as the Discord API: every request is recorded and answered
 * with a new id, except those `fail` matches, answered with Missing
 * Permissions.
 */
function fakeDiscord() {
  const sent: Sent[] = [];
  let failing: RegExp | null = null;
  let next = 700000000000009500n;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(input, init);
    const path = `${request.method} ${new URL(request.url).pathname.replace(/^.*\/api\/v10/, "")}`;
    sent.push({ method: request.method, path });
    if (failing?.test(path)) {
      return Promise.resolve(
        Response.json(
          { message: "Missing Permissions", code: 50013 },
          { status: 403 },
        ),
      );
    }
    next += 1n;
    return Promise.resolve(Response.json({ id: String(next) }));
  });
  return {
    sent,
    fail(match: RegExp | null) {
      failing = match;
    },
  };
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

/** Narrows a web outcome to its success, failing the test on a refusal. */
function doneWeb(
  outcome: WebAdminOutcome,
): Extract<WebAdminOutcome, { kind: "done" }> {
  if (outcome.kind !== "done") throw new Error(`refused: ${outcome.message}`);
  return outcome;
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
): Promise<PollView> {
  const poll = dateVoting(context);
  new PollStore(context.storage).setVotes(poll.id, MEMBER, [
    poll.options[0]?.id ?? 0,
  ]);
  discord.fail(failing);
  await done(await closeVote(context, OWNER, { pollId: poll.id })).work();
  discord.fail(null);
  discord.sent.length = 0;
  return poll;
}

const THREAD_FAILS = new RegExp(`^POST /channels/${FORUM}/threads$`);

// Reading the panel.

interface Node {
  content?: string;
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

/** The panel's text lines. */
function panelLines(storage: DurableObjectStorage): string[] {
  return flatten(
    renderAdminPanel(loadAdminPanelState(storage)) as unknown as Node[],
  )
    .map((c) => c.content ?? "")
    .flatMap((c) => c.split("\n"));
}

/** The panel's round controls' labels, as the web page must offer them. */
function panelRoundLabels(storage: DurableObjectStorage): string[] {
  return actionButtons(loadAdminPanelState(storage))
    .map((b) => b.label ?? "")
    .filter((label) => !["Set map pin", "Settings", "Refresh"].includes(label));
}

function labels(actions: WebAdminAction[]): string[] {
  return actions.map((a) => a.label);
}

function primaries(actions: WebAdminAction[]): WebAdminAction[] {
  return actions.filter((a) => a.style === "primary");
}

/** Checks that the controls that ask first carry the panel's question. */
function expectConfirms(
  actions: WebAdminAction[],
  closing: PollWording | null = null,
): void {
  for (const action of actions) {
    const expected =
      action.kind === "cancel-round"
        ? CANCEL_QUESTION
        : action.kind === "withdraw-date-vote"
          ? WITHDRAW_QUESTION
          : action.kind === "close-vote" && closing !== null
            ? closeQuestion(closing)
            : null;
    expect(action.confirm).toEqual(expected);
  }
}

function sourceOf(
  context: RoundContext,
  store: PollStore,
  isAdmin: boolean,
): WebViewSource {
  return {
    env,
    guildId: context.guildId,
    viewerId: OWNER,
    isAdmin,
    settings: new GuildConfig(context.storage).get(),
    directory: { name: "x", iconHash: null, channels: {} },
    store,
    storage: context.storage,
    now: store.now(),
    log: { page: 1, pageSize: 5 },
  };
}

describe("webAdminActions", () => {
  it("offers nothing before setup is complete, and says why", async () => {
    await inGuild("200000000000009501", (context, store) => {
      new GuildConfig(context.storage).set("voteChannelId", TEXT);
      const actions = webAdminActions(context.storage);
      expect(actions).toEqual([]);
      expect(labels(actions)).toEqual(panelRoundLabels(context.storage));
      const section = adminSection(sourceOf(context, store, true));
      expect(section?.actions).toEqual([]);
      expect(section?.setupMissing).toBe(locationVoteRefusal(context)?.message);
      expect(section?.setupMissing).toMatch(/^Set the /);
    });
  });

  it("offers Start location vote once setup is complete", async () => {
    await inGuild("200000000000009502", (context, store) => {
      configure(context.storage);
      const actions = webAdminActions(context.storage);
      expect(labels(actions)).toEqual(["Start location vote"]);
      expect(labels(actions)).toEqual(panelRoundLabels(context.storage));
      expect(actions[0]).toEqual({
        kind: "start-location-vote",
        label: "Start location vote",
        target: null,
        style: "primary",
        note: null,
        confirm: null,
      });
      expect(
        adminSection(sourceOf(context, store, true))?.setupMissing,
      ).toBeNull();
    });
  });

  it("offers Close location vote and Cancel round while the location vote is open", async () => {
    await inGuild("200000000000009503", (context) => {
      const poll = locationVoting(context);
      const actions = webAdminActions(context.storage);
      expect(labels(actions)).toEqual(["Close location vote", "Cancel round"]);
      expect(labels(actions)).toEqual(panelRoundLabels(context.storage));
      expect(primaries(actions).map((a) => a.label)).toEqual([
        "Close location vote",
      ]);
      expect(actions.map((a) => a.target)).toEqual([poll.id, poll.roundId]);
      expect(actions[1]?.style).toBe("danger");
      expectConfirms(actions, LOCATION_POLL);
      expect(actions[0]?.confirm).toEqual(closeQuestion(LOCATION_POLL));
    });
  });

  it("offers Start date vote and Cancel round once the location is decided", async () => {
    await inGuild("200000000000009504", (context) => {
      decided(context);
      const actions = webAdminActions(context.storage);
      expect(labels(actions)).toEqual(["Start date vote", "Cancel round"]);
      expect(labels(actions)).toEqual(panelRoundLabels(context.storage));
      expect(primaries(actions).map((a) => a.label)).toEqual([
        "Start date vote",
      ]);
      expectConfirms(actions);
    });
  });

  it("offers Withdraw date vote, quiet, just before Cancel round while the date vote is open", async () => {
    await inGuild("200000000000009505", (context) => {
      const poll = dateVoting(context);
      const actions = webAdminActions(context.storage);
      expect(labels(actions)).toEqual([
        "Close date vote",
        "Withdraw date vote",
        "Cancel round",
      ]);
      const panel = panelRoundLabels(context.storage);
      expect(panel).toEqual(["Close date vote", "Cancel round"]);
      expect(labels(actions).filter((l) => l !== "Withdraw date vote")).toEqual(
        panel,
      );
      expect(primaries(actions).map((a) => a.label)).toEqual([
        "Close date vote",
      ]);
      expect(actions[1]).toEqual({
        kind: "withdraw-date-vote",
        label: "Withdraw date vote",
        target: poll.id,
        style: "quiet",
        note: null,
        confirm: WITHDRAW_QUESTION,
      });
      expectConfirms(actions, DATE_POLL);
    });
  });

  it("offers Create hike thread with the panel's line after the thread failed", async () => {
    const discord = fakeDiscord();
    await inGuild("200000000000009506", async (context) => {
      const poll = await completed(context, discord, THREAD_FAILS);
      const actions = webAdminActions(context.storage);
      expect(labels(actions)).toEqual(panelRoundLabels(context.storage));
      expect(labels(actions)[0]).toBe("Start location vote");
      expect(primaries(actions).map((a) => a.label)).toEqual([
        "Start location vote",
      ]);
      const thread = actions.find((a) => a.kind === "create-hike-thread");
      const line = panelLines(context.storage).find((l) =>
        l.startsWith("**Hike thread:** not created. "),
      );
      expect(line).toBeDefined();
      expect(thread).toEqual({
        kind: "create-hike-thread",
        label: "Create hike thread",
        target: poll.roundId,
        style: "secondary",
        note: line,
        confirm: null,
      });
      expectConfirms(actions);
    });
  });
});

describe("adminSection", () => {
  it("is null for a member who is not an admin", async () => {
    await inGuild("200000000000009511", (context, store) => {
      decided(context);
      expect(adminSection(sourceOf(context, store, false))).toBeNull();
    });
  });

  it("gives the start forms' fields, the dates filled in while the location is decided", async () => {
    await inGuild("200000000000009512", (context, store) => {
      configure(context.storage);
      const empty = adminSection(sourceOf(context, store, true));
      expect(empty?.locationsField).toEqual(START_LOCATIONS_FIELD);
      expect(empty?.datesField).toEqual({ ...START_DATES_FIELD, value: [] });

      const poll = locationVoting(context);
      expect(
        adminSection(sourceOf(context, store, true))?.datesField.value,
      ).toEqual([]);

      store.setVotes(poll.id, MEMBER, [poll.options[0]?.id ?? 0]);
      store.closePoll(poll.id, OWNER);
      const section = adminSection(sourceOf(context, store, true));
      expect(section?.locationsField).toEqual(START_LOCATIONS_FIELD);
      const dates = defaultDates(context);
      expect(dates.length).toBeGreaterThan(0);
      expect(section?.datesField).toEqual({
        label: START_DATES_FIELD.label,
        hint: START_DATES_FIELD.hint,
        placeholder: START_DATES_FIELD.placeholder,
        maxLength: START_DATES_FIELD.maxLength,
        required: START_DATES_FIELD.required,
        value: dates,
      });

      store.startDatePoll(poll.roundId, OWNER, DATES);
      expect(
        adminSection(sourceOf(context, store, true))?.datesField.value,
      ).toEqual([]);
    });
  });
});

describe("runWebAdminAction", () => {
  it("starts the location vote as the actor, with the panel's note", async () => {
    fakeDiscord();
    await inGuild("200000000000009521", async (context, store) => {
      configure(context.storage);
      const outcome = await runWebAdminAction(context, ACTOR, {
        action: "start-location-vote",
        target: null,
        text: "Ridge Trail\n\nLake Loop",
      });
      expect(outcome).toEqual({
        kind: "done",
        notes: [`The location vote is open in <#${TEXT}>.`],
        finishing: false,
        retries: [],
      });
      const round = store.getActiveRound();
      expect(round?.startedBy).toBe(ACTOR);
      expect(
        round?.locationPoll?.options.map((o) => [o.label, o.proposedBy]),
      ).toEqual([
        ["Ridge Trail", ACTOR],
        ["Lake Loop", ACTOR],
      ]);
      expect(round?.locationPoll?.messageId).not.toBeNull();
    });
  });

  it("refuses locations the start modal refuses, with its sentence, and starts nothing", async () => {
    const discord = fakeDiscord();
    await inGuild("200000000000009522", async (context, store) => {
      configure(context.storage);
      const tooMany = Array.from(
        { length: 26 },
        (_, i) => `Place ${String(i + 1)}`,
      ).join("\n");
      const tooLong = `Ridge Trail\n${"L".repeat(81)}`;
      for (const text of [tooMany, tooLong]) {
        const parsed = parseInitialLocations(text);
        expect(parsed.ok).toBe(false);
        expect(
          await runWebAdminAction(context, ACTOR, {
            action: "start-location-vote",
            target: null,
            text,
          }),
        ).toEqual({
          kind: "refused",
          code: "invalid_labels",
          message: parsed.ok ? "" : parsed.error,
        });
      }
      expect(store.getActiveRound()).toBeNull();
      expect(store.getLastRound()).toBeNull();
      expect(discord.sent).toEqual([]);
    });
  });

  it("refuses dates the start modal refuses, with its sentence", async () => {
    const discord = fakeDiscord();
    await inGuild("200000000000009523", async (context, store) => {
      decided(context);
      const text = "2030-06-08\nnot a date";
      const parsed = parseCandidateDates(text, store.now(), ZONE);
      expect(parsed.ok).toBe(false);
      expect(
        await runWebAdminAction(context, ACTOR, {
          action: "start-date-vote",
          target: null,
          text,
        }),
      ).toEqual({
        kind: "refused",
        code: "invalid_dates",
        message: parsed.ok ? "" : parsed.error,
      });
      expect(store.getActiveRound()?.status).toBe("location_decided");
      expect(discord.sent).toEqual([]);
    });
  });

  it("starts the date vote as the actor", async () => {
    fakeDiscord();
    await inGuild("200000000000009524", async (context, store) => {
      decided(context);
      const outcome = doneWeb(
        await runWebAdminAction(context, ACTOR, {
          action: "start-date-vote",
          target: null,
          text: DATES.join("\n"),
        }),
      );
      expect(outcome.notes).toEqual([`The date vote is open in <#${TEXT}>.`]);
      const poll = store.getActiveRound()?.datePoll;
      expect(poll?.status).toBe("open");
      expect(poll?.options).toHaveLength(2);
    });
  });

  it("closes the vote as the actor, and refuses a stale close without changing anything", async () => {
    const discord = fakeDiscord();
    await inGuild("200000000000009525", async (context, store) => {
      const poll = locationVoting(context);
      store.setVotes(poll.id, MEMBER, [poll.options[1]?.id ?? 0]);
      const request = {
        action: "close-vote" as const,
        target: poll.id,
        text: null,
      };
      const outcome = doneWeb(await runWebAdminAction(context, ACTOR, request));
      expect(outcome.finishing).toBe(false);
      expect(outcome.notes[0]).toMatch(/^The location vote is closed:/);
      expect(outcome.retries).toEqual([]);
      const closed = new PollStore(context.storage).getPoll(poll.id);
      expect(closed?.closedBy).toBe(ACTOR);
      expect(closed?.status).toBe("closed");

      const sent = discord.sent.length;
      const round = store.getRound(poll.roundId);
      expect(await runWebAdminAction(context, ACTOR, request)).toEqual({
        kind: "refused",
        code: "not_open",
        message: "That vote is no longer open.",
      });
      expect(store.getPoll(poll.id)).toEqual(closed);
      expect(store.getRound(poll.roundId)).toEqual(round);
      expect(discord.sent).toHaveLength(sent);
    });
  });

  it("cancels the round, and refuses a stale cancel", async () => {
    fakeDiscord();
    await inGuild("200000000000009526", async (context, store) => {
      const poll = locationVoting(context);
      const request = {
        action: "cancel-round" as const,
        target: poll.roundId,
        text: null,
      };
      expect(await runWebAdminAction(context, ACTOR, request)).toEqual({
        kind: "done",
        notes: ["The round is cancelled."],
        finishing: false,
        retries: [],
      });
      expect(store.getRound(poll.roundId)?.status).toBe("cancelled");
      expect(store.getActiveRound()).toBeNull();
      expect(await runWebAdminAction(context, ACTOR, request)).toEqual({
        kind: "refused",
        code: "ended",
        message: "That round has already ended.",
      });
    });
  });

  it("withdraws the date vote, and refuses a stale withdrawal", async () => {
    fakeDiscord();
    await inGuild("200000000000009527", async (context, store) => {
      const poll = dateVoting(context);
      const request = {
        action: "withdraw-date-vote" as const,
        target: poll.id,
        text: null,
      };
      expect(await runWebAdminAction(context, ACTOR, request)).toEqual({
        kind: "done",
        notes: ["The date vote is withdrawn."],
        finishing: false,
        retries: [],
      });
      expect(store.getActiveRound()?.status).toBe("location_decided");
      expect(store.getActiveRound()?.datePoll).toBeNull();
      expect(await runWebAdminAction(context, ACTOR, request)).toEqual({
        kind: "refused",
        code: "not_open",
        message: "There is no open date vote to withdraw.",
      });
    });
  });

  it("offers Create hike thread when Discord refuses the thread at the close, then creates it", async () => {
    const discord = fakeDiscord();
    await inGuild("200000000000009528", async (context, store) => {
      const poll = dateVoting(context);
      store.setVotes(poll.id, MEMBER, [poll.options[0]?.id ?? 0]);
      discord.fail(THREAD_FAILS);
      const closed = doneWeb(
        await runWebAdminAction(context, ACTOR, {
          action: "close-vote",
          target: poll.id,
          text: null,
        }),
      );
      expect(closed.finishing).toBe(false);
      expect(store.getPoll(poll.id)?.closedBy).toBe(ACTOR);
      const retry = closed.retries.find((a) => a.kind === "create-hike-thread");
      expect(retry).toMatchObject({
        label: "Create hike thread",
        target: poll.roundId,
        confirm: null,
      });
      expect(retry?.note).toMatch(/^\*\*Hike thread:\*\* not created\. /);
      expect(
        closed.retries.every((a) => a.note !== null && a.confirm === null),
      ).toBe(true);

      discord.fail(null);
      const created = doneWeb(
        await runWebAdminAction(context, ACTOR, {
          action: "create-hike-thread",
          target: retry?.target ?? 0,
          text: null,
        }),
      );
      const threadId = store.getLastRound()?.threadId ?? "";
      expect(threadId).not.toBe("");
      expect(created.notes[0]).toBe(`The hike thread is open: <#${threadId}>.`);
      expect(created.finishing).toBe(false);
      expect(created.retries.some((a) => a.kind === "create-hike-thread")).toBe(
        false,
      );
    });
  });

  it("answers finishing when the Discord work takes longer than it waits, and the work goes on", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        await gate;
        return Response.json({ id: "700000000000009599" });
      });
    await inGuild("200000000000009529", async (context, store) => {
      configure(context.storage);
      const outcome = await runWebAdminAction(
        context,
        ACTOR,
        { action: "start-location-vote", target: null, text: "Ridge Trail" },
        1,
      );
      expect(outcome).toEqual({
        kind: "done",
        notes: [],
        finishing: true,
        retries: [],
      });
      const pollId = store.getActiveRound()?.locationPoll?.id ?? 0;
      expect(store.getPoll(pollId)?.messageId).toBeNull();

      release();
      await vi.waitFor(() => {
        expect(store.getPoll(pollId)?.messageId).toBe("700000000000009599");
      });
      expect(store.getPoll(pollId)?.channelId).toBe(TEXT);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
