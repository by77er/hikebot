import {
  createExecutionContext,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  InteractionResponseType,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ADMIN_PANEL_IDS,
  POLL_CONTROL_IDS,
} from "../../src/features/admin-panel";
import {
  announcementStatus,
  claimAnnouncement,
} from "../../src/features/announcement-state";
import {
  ANNOUNCE_PART,
  CLOSE_PART_CLAIM_MS,
  FINALIZE_PART,
  finishPart,
  partState,
  pendingClose,
  pendingCloses,
  recordPendingClose,
  startPart,
} from "../../src/features/close-flow-state";
import { DATE_POLL } from "../../src/features/date-vote";
import { claimHikeThread } from "../../src/features/hike-thread-state";
import {
  CLOSE_FLOW_DELAY_MS,
  CLOSE_FLOW_JOB,
  POLL_IDS,
  closePoll,
  runCloseFlow,
} from "../../src/features/poll-ui";
import { GuildConfig } from "../../src/guild/config";
import { scheduledJobs } from "../../src/guild/schedule";
import { PollStore, type PollView } from "../../src/polls/store";
import {
  callWorker,
  componentInteraction,
  createSigner,
  signedRequest,
  type Signer,
} from "../helpers";

const OWNER = "400000000000000001";
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const THREAD = "900000000000000001";
const EVENT = "950000000000000001";
const ANNOUNCEMENT = "960000000000000001";
const LOCATION_MESSAGE = "700000000000000001";
const DATE_MESSAGE = "700000000000000002";

const THREAD_STEP = "create the hike thread";
const EVENT_STEP = "create the hike event";

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface Node {
  type: number;
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

function text(components: readonly unknown[] = []): string {
  return flatten(components as Node[])
    .map((c) => c.content ?? "")
    .filter((c) => c !== "")
    .join("\n");
}

function ids(components: readonly unknown[] = []): string[] {
  return flatten(components as Node[]).flatMap((c) =>
    c.custom_id === undefined ? [] : [c.custom_id],
  );
}

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

/**
 * A guild whose date vote is open, with both poll messages posted, that
 * Sat, 15 Jun 2030 wins at Lake Loop.
 */
async function dateVoting(guildId: string): Promise<PollView> {
  return runInDurableObject(stub(guildId), (_i, state) => {
    const config = new GuildConfig(state.storage);
    config.set("voteChannelId", TEXT);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
    const store = new PollStore(state.storage);
    const started = store.startRound(OWNER, [
      { label: "Lake Loop", details: null, proposedBy: OWNER },
    ]);
    const location = started.locationPoll?.id ?? 0;
    store.setPollMessage(location, TEXT, LOCATION_MESSAGE);
    store.setVotes(location, "u1", [started.locationPoll?.options[0]?.id ?? 0]);
    store.closePoll(location, OWNER);
    const date = store.startDatePoll(started.id, OWNER, [
      "2030-06-15",
      "2030-06-08",
    ]);
    store.setPollMessage(date.id, TEXT, DATE_MESSAGE);
    const winner = date.options.find(
      (o) => o.dateValue?.startsWith("2030-06-15") ?? false,
    );
    store.setVotes(date.id, "u1", [winner?.id ?? 0]);
    return store.getPoll(date.id) as PollView;
  });
}

function click(
  customId: string,
  guildId: string,
): APIMessageComponentInteraction {
  const interaction = componentInteraction(customId, guildId);
  Object.assign(interaction, {
    member: { user: { id: OWNER }, roles: [] },
    message: { id: "800000000000000009", components: [] },
  });
  return interaction;
}

interface Sent {
  route: string;
  body: { components?: APIMessageTopLevelComponent[] };
}

/**
 * Stubs Discord: the guild's owner, a thread `THREAD`, an event `EVENT`,
 * an announcement `ANNOUNCEMENT`, and `announce()` for posts in `NEWS`;
 * anything else answers id 1. Returns what the bot sent, GETs left out.
 */
function discord(
  guildId: string,
  announce: () => Response = () => Response.json({ id: ANNOUNCEMENT }),
) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname.replace("/api/v10", "");
    if (request.method !== "GET") {
      sent.push({
        route: `${request.method} ${path}`,
        body: JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as Sent["body"],
      });
    }
    if (path === `/guilds/${guildId}`) {
      return Promise.resolve(Response.json({ id: guildId, owner_id: OWNER }));
    }
    if (path.endsWith("/threads")) {
      return Promise.resolve(
        Response.json({ id: THREAD, parent_id: FORUM }, { status: 201 }),
      );
    }
    if (path.endsWith("/scheduled-events")) {
      return Promise.resolve(Response.json({ id: EVENT, guild_id: guildId }));
    }
    if (path === `/channels/${NEWS}/messages`) {
      return Promise.resolve(announce());
    }
    return Promise.resolve(Response.json({ id: "1" }));
  });
  return sent;
}

const routes = (sent: Sent[]) => sent.map((r) => r.route);

const ROUTES = {
  finalEdit: `PATCH /channels/${TEXT}/messages/${DATE_MESSAGE}`,
  thread: `POST /channels/${FORUM}/threads`,
  announcement: `POST /channels/${NEWS}/messages`,
  panel: "PATCH /webhooks/100/interaction-token/messages/@original",
};

const isEvent = (route: string) => route.endsWith("/scheduled-events");

/** Sends the interaction through the Worker and waits for its follow-up. */
async function send(interaction: unknown) {
  const ctx = createExecutionContext();
  const response = await callWorker(
    signer,
    await signedRequest(signer, interaction),
    ctx,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{
    type: InteractionResponseType;
    data?: { components: APIMessageTopLevelComponent[] };
  }>();
  await waitOnExecutionContext(ctx);
  return body;
}

/**
 * Closes the date vote through the object without running its follow-up,
 * as when the object restarts before the Worker asks for it.
 */
async function closeWithoutFollowUp(guildId: string, view: PollView) {
  const outcome = await stub(guildId).handleInteraction(
    click(POLL_IDS.closeConfirm(view.id), guildId),
  );
  expect(outcome).toEqual({
    response: { type: InteractionResponseType.DeferredMessageUpdate },
    followUp: true,
  });
  await evictDurableObject(stub(guildId));
}

function inObject<T>(
  guildId: string,
  run: (storage: DurableObjectStorage) => T | Promise<T>,
): Promise<T> {
  return runInDurableObject(stub(guildId), (_i, state) => run(state.storage));
}

/** The panel's status view, redrawn through Refresh. */
async function panel(guildId: string) {
  const reply = await send(click(ADMIN_PANEL_IDS.refresh, guildId));
  return {
    shown: text(reply.data?.components),
    buttons: ids(reply.data?.components),
  };
}

describe("the stored close work", () => {
  it("lists the final edit, the steps by name and the announcement, and drops each part as it finishes", async () => {
    await inObject("close-flow-record", (storage) => {
      recordPendingClose(storage, 7, "1", "UTC", ["make a thing"]);
      expect(pendingClose(storage, 7)?.parts).toEqual([
        { name: FINALIZE_PART, startedAt: null },
        { name: "make a thing", startedAt: null },
        { name: ANNOUNCE_PART, startedAt: null },
      ]);
      expect(startPart(storage, 7, FINALIZE_PART, 1000)).toBe(true);
      // Held by this object's run until it finishes or the claim lapses.
      expect(startPart(storage, 7, FINALIZE_PART, 1001)).toBe(false);
      expect(
        startPart(storage, 7, FINALIZE_PART, 1000 + CLOSE_PART_CLAIM_MS),
      ).toBe(true);
      finishPart(storage, 7, FINALIZE_PART);
      finishPart(storage, 7, "make a thing", ["**Thing:** made"]);
      expect(pendingClose(storage, 7)).toMatchObject({
        parts: [{ name: ANNOUNCE_PART, startedAt: null }],
        announce: ["**Thing:** made"],
      });
      finishPart(storage, 7, ANNOUNCE_PART);
      expect(pendingClose(storage, 7)).toBeNull();
      expect(pendingCloses(storage)).toEqual([]);
    });
  });

  it("takes a part started before the object restarted as cut off at once", async () => {
    const guild = "close-flow-restart";
    const now = await inObject(guild, (storage) => {
      recordPendingClose(storage, 7, "1", "UTC", []);
      const at = new PollStore(storage).now();
      startPart(storage, 7, FINALIZE_PART, at);
      return at;
    });
    await evictDurableObject(stub(guild));
    await inObject(guild, (storage) => {
      const part = pendingClose(storage, 7)?.parts[0];
      expect(part?.startedAt).toBe(now);
      expect(part && partState(storage, 7, part, now + 1).state).toBe(
        "cut-off",
      );
    });
  });
});

describe("closing a poll", () => {
  it("records its close work and schedules the job in the transaction that closes it", async () => {
    const guild = "close-flow-records";
    const view = await dateVoting(guild);
    discord(guild);
    await inObject(guild, async (storage) => {
      const store = new PollStore(storage);
      const before = store.now();
      await closePoll(
        click(POLL_IDS.closeConfirm(view.id), guild),
        { env, storage },
        { date: DATE_POLL },
      );
      expect(store.getPoll(view.id)?.status).toBe("closed");
      expect(pendingClose(storage, view.id)).toEqual({
        pollId: view.id,
        guildId: guild,
        timeZone: "America/Los_Angeles",
        parts: [FINALIZE_PART, THREAD_STEP, EVENT_STEP, ANNOUNCE_PART].map(
          (name) => ({ name, startedAt: null }),
        ),
        announce: [],
      });
      const due = (await scheduledJobs(storage)).get(CLOSE_FLOW_JOB);
      expect(due).toBeGreaterThanOrEqual(before + CLOSE_FLOW_DELAY_MS);
      expect(due).toBeLessThanOrEqual(store.now() + CLOSE_FLOW_DELAY_MS);
    });
  });

  it("leaves neither the closed poll nor its close work when the transaction fails", async () => {
    const guild = "close-flow-rollback";
    const view = await dateVoting(guild);
    discord(guild);
    await inObject(guild, async (storage) => {
      const put = storage.kv.put.bind(storage.kv);
      vi.spyOn(storage.kv, "put").mockImplementation((key, value) => {
        if (key.startsWith("pending-close:")) throw new Error("disk full");
        put(key, value);
      });
      await expect(
        closePoll(
          click(POLL_IDS.closeConfirm(view.id), guild),
          { env, storage },
          { date: DATE_POLL },
        ),
      ).rejects.toThrow("disk full");
      vi.mocked(storage.kv.put).mockRestore();
      const store = new PollStore(storage);
      expect(store.getPoll(view.id)?.status).toBe("open");
      expect(store.getActiveRound()?.status).toBe("date_voting");
      expect(pendingClose(storage, view.id)).toBeNull();
      expect((await scheduledJobs(storage)).has(CLOSE_FLOW_JOB)).toBe(false);
    });
  });
});

describe("the close-flow job", () => {
  it("finishes the flow once when the follow-up never ran", async () => {
    const guild = "200000000000000801";
    const view = await dateVoting(guild);
    const sent = discord(guild);
    await closeWithoutFollowUp(guild, view);
    expect(sent).toEqual([]);

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(routes(sent)).toEqual([
      ROUTES.finalEdit,
      ROUTES.thread,
      `POST /guilds/${guild}/scheduled-events`,
      `PATCH /channels/${THREAD}/messages/${THREAD}`,
      ROUTES.announcement,
    ]);
    const [edit, , , , announcement] = sent.map((r) => text(r.body.components));
    expect(edit).toContain("🏆 **Sat, 15 Jun 2030 · 11:00** won with 1 vote.");
    expect(ids(sent[0]?.body.components)).toEqual([]);
    expect(announcement?.split("\n").slice(-2)).toEqual([
      `**Hike thread:** <#${THREAD}>`,
      `**Hike event:** https://discord.com/events/${guild}/${EVENT}`,
    ]);

    // Nothing is left, so the job is not scheduled again.
    await inObject(guild, async (storage) => {
      expect(pendingClose(storage, view.id)).toBeNull();
      expect(await scheduledJobs(storage)).toEqual(new Map());
      expect(announcementStatus(storage, view.id, Date.now())).toEqual({
        state: "posted",
        messageId: ANNOUNCEMENT,
      });
    });
    expect(await runDurableObjectAlarm(stub(guild))).toBe(false);
    expect(sent).toHaveLength(5);
  });

  it("posts nothing after a follow-up that ran", async () => {
    const guild = "200000000000000802";
    const view = await dateVoting(guild);
    const sent = discord(guild);
    const reply = await send(click(POLL_IDS.closeConfirm(view.id), guild));
    expect(reply.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(routes(sent)).toEqual([
      ROUTES.finalEdit,
      ROUTES.thread,
      `POST /guilds/${guild}/scheduled-events`,
      `PATCH /channels/${THREAD}/messages/${THREAD}`,
      ROUTES.announcement,
      ROUTES.panel,
    ]);
    expect(text(sent[5]?.body.components)).toContain(
      "The date vote is closed: **Sat, 15 Jun 2030 · 11:00** won with 1 vote.",
    );

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(routes(sent).filter((r) => r === ROUTES.announcement)).toHaveLength(
      1,
    );
    expect(routes(sent).filter((r) => r === ROUTES.thread)).toHaveLength(1);
    expect(routes(sent).filter(isEvent)).toHaveLength(1);
    expect(sent).toHaveLength(6);
    expect(await inObject(guild, (storage) => scheduledJobs(storage))).toEqual(
      new Map(),
    );
    expect(await runDurableObjectAlarm(stub(guild))).toBe(false);
  });

  it("runs without an interaction and leaves the panel alone", async () => {
    const guild = "200000000000000803";
    const view = await dateVoting(guild);
    const sent = discord(guild);
    await closeWithoutFollowUp(guild, view);
    const run = await inObject(guild, (storage) =>
      runCloseFlow(view.id, { env, storage }, { date: DATE_POLL }),
    );
    expect(run).toEqual({
      notes: [
        "The date vote is closed: **Sat, 15 Jun 2030 · 11:00** won with 1 vote.",
      ],
      waiting: false,
    });
    expect(routes(sent)).not.toContain(ROUTES.panel);
    expect(routes(sent)).toContain(ROUTES.announcement);
  });

  it("waits for a part this object is still doing, then stops once it is done", async () => {
    const guild = "200000000000000804";
    const view = await dateVoting(guild);
    discord(guild);
    await closeWithoutFollowUp(guild, view);
    await inObject(guild, async (storage) => {
      const store = new PollStore(storage);
      startPart(storage, view.id, FINALIZE_PART, store.now());
      const run = await runCloseFlow(
        view.id,
        { env, storage },
        { date: DATE_POLL },
      );
      expect(run.waiting).toBe(true);
      expect(pendingClose(storage, view.id)?.parts).toHaveLength(4);
    });
    // The job finds the part held, so it schedules itself again.
    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(await inObject(guild, (storage) => scheduledJobs(storage))).toEqual(
      new Map([[CLOSE_FLOW_JOB, expect.any(Number) as number]]),
    );
    await inObject(guild, (storage) => {
      finishPart(storage, view.id, FINALIZE_PART);
    });
    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    await inObject(guild, async (storage) => {
      expect(pendingClose(storage, view.id)).toBeNull();
      expect(await scheduledJobs(storage)).toEqual(new Map());
    });
  });

  it("does not create a cut-off thread again; the panel shows it unconfirmed and Create hike thread creates it once", async () => {
    const guild = "200000000000000805";
    const view = await dateVoting(guild);
    const sent = discord(guild);
    await closeWithoutFollowUp(guild, view);
    await inObject(guild, (storage) => {
      const store = new PollStore(storage);
      const long = store.now() - 2 * CLOSE_PART_CLAIM_MS;
      const round = store.getRound(view.roundId);
      if (round === null) throw new Error("no round");
      // The thread step started and was cut off before Discord answered.
      startPart(storage, view.id, THREAD_STEP, long);
      expect(claimHikeThread(storage, round, long)).toBe(true);
    });

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(routes(sent)).toEqual([
      ROUTES.finalEdit,
      `POST /guilds/${guild}/scheduled-events`,
      ROUTES.announcement,
    ]);

    const before = await panel(guild);
    expect(before.shown).toContain(
      "**Hike thread:** not confirmed: creating it was cut off, so it may or may not exist.",
    );
    expect(before.buttons).toContain(
      POLL_CONTROL_IDS.createHikeThread(view.roundId),
    );
    await send(click(POLL_CONTROL_IDS.createHikeThread(view.roundId), guild));
    expect(routes(sent).filter((r) => r === ROUTES.thread)).toHaveLength(1);
    const after = await panel(guild);
    expect(after.shown).toContain(`**Hike thread:** <#${THREAD}>`);
    expect(after.buttons).not.toContain(
      POLL_CONTROL_IDS.createHikeThread(view.roundId),
    );
    expect(await runDurableObjectAlarm(stub(guild))).toBe(false);
  });
});

describe("Announce <vote>", () => {
  it("does not post a cut-off announcement again; the panel shows it unconfirmed and Announce posts it once", async () => {
    const guild = "200000000000000806";
    const view = await dateVoting(guild);
    const sent = discord(guild);
    await closeWithoutFollowUp(guild, view);
    await inObject(guild, (storage) => {
      const long = new PollStore(storage).now() - 2 * CLOSE_PART_CLAIM_MS;
      startPart(storage, view.id, ANNOUNCE_PART, long);
      claimAnnouncement(
        storage,
        view.id,
        { guildId: guild, timeZone: "America/Los_Angeles", extra: [] },
        long,
      );
    });

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(routes(sent)).not.toContain(ROUTES.announcement);
    expect(routes(sent)).toContain(ROUTES.thread);

    const before = await panel(guild);
    expect(before.shown).toContain(
      "**Date vote announcement:** not confirmed: posting it was cut off, so it may or may not have been posted.",
    );
    expect(before.buttons).toContain(POLL_CONTROL_IDS.announce(view.id));

    const retried = await send(
      click(POLL_CONTROL_IDS.announce(view.id), guild),
    );
    expect(retried.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(routes(sent).filter((r) => r === ROUTES.announcement)).toHaveLength(
      1,
    );
    expect(text(sent.at(-1)?.body.components)).toContain(
      `The date vote's result is announced in <#${NEWS}>.`,
    );
    expect(ids(sent.at(-1)?.body.components)).not.toContain(
      POLL_CONTROL_IDS.announce(view.id),
    );
  });

  it("retries a failed post once, and a second press after it was posted posts nothing", async () => {
    const guild = "200000000000000807";
    const view = await dateVoting(guild);
    let refuse = true;
    const sent = discord(guild, () =>
      refuse
        ? Response.json(
            { message: "Missing Permissions", code: 50013 },
            { status: 403 },
          )
        : Response.json({ id: ANNOUNCEMENT }),
    );
    await send(click(POLL_IDS.closeConfirm(view.id), guild));
    const closed = text(sent.at(-1)?.body.components);
    expect(closed).toContain(
      `**Date vote announcement:** not posted. Could not post the announcement in <#${NEWS}>: Discord answered: Missing Permissions (HTTP 403, code 50013). Check that the bot can post there, then click Announce date vote.`,
    );
    expect(ids(sent.at(-1)?.body.components)).toContain(
      POLL_CONTROL_IDS.announce(view.id),
    );

    refuse = false;
    await send(click(POLL_CONTROL_IDS.announce(view.id), guild));
    const announcements = () =>
      sent.filter((r) => r.route === ROUTES.announcement);
    expect(announcements()).toHaveLength(2);
    // The retry is the announcement the close flow would have posted.
    expect(text(announcements()[1]?.body.components)).toBe(
      text(announcements()[0]?.body.components),
    );
    expect(text(announcements()[1]?.body.components)).toContain(
      `**Hike thread:** <#${THREAD}>`,
    );

    const again = await send(click(POLL_CONTROL_IDS.announce(view.id), guild));
    expect(again.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(again.data?.components)).toContain(
      "The date vote's announcement is already posted.",
    );
    expect(announcements()).toHaveLength(2);
    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(announcements()).toHaveLength(2);
  });

  it("refuses a second press while the first is posting", async () => {
    const guild = "200000000000000808";
    const view = await dateVoting(guild);
    discord(guild);
    await closeWithoutFollowUp(guild, view);
    await inObject(guild, (storage) => {
      const now = new PollStore(storage).now();
      claimAnnouncement(
        storage,
        view.id,
        { guildId: guild, timeZone: "UTC", extra: [] },
        now,
      );
    });
    const reply = await send(click(POLL_CONTROL_IDS.announce(view.id), guild));
    expect(text(reply.data?.components)).toContain(
      "The date vote's announcement is being posted.",
    );
  });
});
