import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  ApplicationCommandOptionType,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
  type APIInteractionResponse,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarAddress } from "../../src/calendar/address";
import { registerFeatures } from "../../src/features";
import {
  CALENDAR_HINT,
  HIKES_PER_PAGE,
  LOG_DETAILS_CAP,
  NO_HIKES_MESSAGE,
  renderHikeLog,
} from "../../src/features/hike-log";
import {
  MAX_MESSAGE_COMPONENTS,
  MAX_MESSAGE_TEXT,
} from "../../src/features/poll-ui";
import { Router } from "../../src/guild/router";
import {
  MAX_DETAILS_LENGTH,
  MAX_LABEL_LENGTH,
  PollStore,
  type HikeView,
} from "../../src/polls/store";
import { discordFetch } from "../guild/web-view-helpers";
import { commandInteraction, componentInteraction } from "../helpers";
import { completeRound, withStore } from "../polls/helpers";

const STRANGER = "400000000000000003";

afterEach(() => {
  vi.restoreAllMocks();
});

interface Node {
  type: ComponentType;
  content?: string;
  custom_id?: string;
  label?: string;
  disabled?: boolean;
  components?: Node[];
  accessory?: Node;
}

function flatten(components: readonly Node[]): Node[] {
  return components.flatMap((c) => [
    c,
    ...flatten(c.components ?? []),
    ...flatten(c.accessory ? [c.accessory] : []),
  ]);
}

function nodes(components: APIMessageTopLevelComponent[]): Node[] {
  return flatten(components);
}

function text(components: APIMessageTopLevelComponent[]): string {
  return nodes(components)
    .map((c) => c.content ?? "")
    .filter((c) => c !== "")
    .join("\n");
}

function buttons(components: APIMessageTopLevelComponent[]) {
  return nodes(components)
    .filter((c) => c.type === ComponentType.Button)
    .map((c) => ({ label: c.label, id: c.custom_id, disabled: c.disabled }));
}

function messageOf(response: APIInteractionResponse) {
  if (
    response.type !== InteractionResponseType.ChannelMessageWithSource &&
    response.type !== InteractionResponseType.UpdateMessage
  ) {
    throw new Error(`not a message: type ${String(response.type)}`);
  }
  const data = response.data ?? {};
  return {
    type: response.type,
    flags: Number(data.flags),
    allowed_mentions: data.allowed_mentions,
    components: data.components ?? [],
  };
}

/** `2030-01-01`, `2030-01-02`, ... for hike `i` (1-based, at most 28). */
function day(i: number): string {
  return `2030-01-${String(i).padStart(2, "0")}`;
}

/** Completes `n` rounds, `Hike 1` on 1 Jan 2030 up to `Hike n`. */
function seed(store: PollStore, n: number): void {
  for (let i = 1; i <= n; i++)
    completeRound(store, `Hike ${String(i)}`, day(i));
}

/**
 * Seeds `hikes` hikes in a fresh guild, then runs `/hike log` as a member
 * who is not an admin, then clicks each of `clicks` (custom_ids) in turn.
 */
function play(
  hikes: number | ((store: PollStore) => void),
  clicks: string[] = [],
) {
  return withStore(async (store, storage) => {
    if (typeof hikes === "number") seed(store, hikes);
    else hikes(store);
    const router = registerFeatures(new Router());
    const context = { env, storage };
    const member = { member: { user: { id: STRANGER }, roles: [] } };
    const command = Object.assign(commandInteraction("hike", "log"), member);
    Object.assign(command.data, {
      options: [{ type: ApplicationCommandOptionType.Subcommand, name: "log" }],
    });
    const answers = [(await router.dispatch(command, context)).response];
    for (const id of clicks) {
      const click = Object.assign(componentInteraction(id, "log"), member);
      answers.push((await router.dispatch(click, context)).response);
    }
    return answers.map(messageOf);
  });
}

function entries(components: APIMessageTopLevelComponent[]): string[] {
  return [...text(components).matchAll(/\*\*(Hike \d+)\*\*/g)].map(
    (m) => m[1] ?? "",
  );
}

/** The log's last lines, for the guild "log" the interactions come from. */
async function calendarLines(): Promise<string> {
  return `Calendar: ${await calendarAddress(env, "log")}\n${CALENDAR_HINT}`;
}

describe("/hike log", () => {
  it("answers any member with an ephemeral Components V2 message that pings no one", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const [reply] = await play(1);
    expect(reply?.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(reply?.flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
    expect(reply?.allowed_mentions).toEqual({ parse: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says there are no hikes yet, without buttons", async () => {
    const [reply] = await play((store) => {
      const round = store.startRound("u-admin", [
        { label: "Ridge", proposedBy: "u1" },
      ]);
      store.cancelRound(round.id, "u-admin");
      store.startRound("u-admin", [{ label: "Lake", proposedBy: "u1" }]);
    });
    const shown = text(reply?.components ?? []);
    expect(shown).toBe(
      `## Hike log\n0 hikes\n${NO_HIKES_MESSAGE}\n${await calendarLines()}`,
    );
    expect(buttons(reply?.components ?? [])).toEqual([]);
  });

  it("shows a hike's date, location, details, thread and event", async () => {
    const [reply] = await play((store) => {
      const id = completeRound(store, "Ridge", "2030-06-15 09:00", "Steep");
      store.setRoundThread(id, "600000000000000001");
      store.setRoundEvent(id, "700000000000000001");
      const lake = completeRound(store, "Lake", "2030-03-01");
      store.setRoundEvent(lake, "700000000000000002");
      completeRound(store, "Bay", "2030-01-01");
    });
    // The interactions come from the guild "log".
    expect(text(reply?.components ?? [])).toBe(
      [
        "## Hike log",
        "3 hikes",
        "Sat, 15 Jun 2030 · 09:00 · **Ridge**",
        "Steep",
        "Thread: <#600000000000000001> · [Event](https://discord.com/events/log/700000000000000001)",
        "Fri, 1 Mar 2030 · 11:00 · **Lake**",
        "[Event](https://discord.com/events/log/700000000000000002)",
        "Tue, 1 Jan 2030 · 11:00 · **Bay**",
        await calendarLines(),
      ].join("\n"),
    );
  });

  it("says 1 hike for one", async () => {
    const [reply] = await play(1);
    expect(text(reply?.components ?? [])).toMatch(/^## Hike log\n1 hike\n/);
    expect(entries(reply?.components ?? [])).toEqual(["Hike 1"]);
  });

  it("lists ten hikes on one page without buttons", async () => {
    const [reply] = await play(HIKES_PER_PAGE);
    expect(entries(reply?.components ?? [])).toEqual(
      Array.from({ length: 10 }, (_, i) => `Hike ${String(10 - i)}`),
    );
    expect(buttons(reply?.components ?? [])).toEqual([]);
  });

  it("pages eleven hikes with Newer and Older, disabling the way that goes nowhere", async () => {
    const [first, second, back] = await play(11, [
      "hb:log:page:2",
      "hb:log:page:1",
    ]);
    expect(text(first?.components ?? [])).toContain("11 hikes · page 1 of 2");
    expect(entries(first?.components ?? [])).toHaveLength(10);
    expect(entries(first?.components ?? [])[0]).toBe("Hike 11");
    expect(buttons(first?.components ?? [])).toEqual([
      { label: "Newer", id: "hb:log:page:0", disabled: true },
      { label: "Older", id: "hb:log:page:2", disabled: false },
    ]);

    expect(second?.type).toBe(InteractionResponseType.UpdateMessage);
    expect(second?.allowed_mentions).toEqual({ parse: [] });
    expect(text(second?.components ?? [])).toContain("11 hikes · page 2 of 2");
    expect(entries(second?.components ?? [])).toEqual(["Hike 1"]);
    expect(buttons(second?.components ?? [])).toEqual([
      { label: "Newer", id: "hb:log:page:1", disabled: false },
      { label: "Older", id: "hb:log:page:3", disabled: true },
    ]);

    expect(back?.components).toEqual(first?.components);
  });

  it("pages 25 hikes and shows the last page for a page past the end", async () => {
    const [, second, third, past, junk] = await play(25, [
      "hb:log:page:2",
      "hb:log:page:3",
      "hb:log:page:9",
      "hb:log:page:x",
    ]);
    expect(entries(second?.components ?? [])).toEqual(
      Array.from({ length: 10 }, (_, i) => `Hike ${String(15 - i)}`),
    );
    expect(entries(third?.components ?? [])).toEqual([
      "Hike 5",
      "Hike 4",
      "Hike 3",
      "Hike 2",
      "Hike 1",
    ]);
    expect(text(third?.components ?? [])).toContain("page 3 of 3");
    expect(past?.components).toEqual(third?.components);
    expect(text(junk?.components ?? [])).toContain("page 1 of 3");
  });

  it("ends with the guild's calendar address on PUBLIC_URL, on every page", async () => {
    const [first, second] = await play(11, ["hb:log:page:2"]);
    const address = await calendarAddress(env, "log");
    expect(address).toMatch(
      /^https:\/\/hikebot\.example\/calendar\/log\/[A-Za-z0-9_-]{43}\.ics$/,
    );
    for (const reply of [first, second]) {
      const shown = text(reply?.components ?? []);
      expect(shown.endsWith(`\n${await calendarLines()}`)).toBe(true);
    }
    expect(CALENDAR_HINT).toContain("Calendar apps can subscribe");
  });

  it("uses custom_ids of the hb scheme", async () => {
    const [reply] = await play(11);
    for (const { id } of buttons(reply?.components ?? [])) {
      expect(id).toMatch(/^hb:log:page:\d+$/);
    }
  });
});

describe("renderHikeLog", () => {
  const longest = (i: number): HikeView => ({
    roundId: 1000 + i,
    location: {
      label: "L".repeat(MAX_LABEL_LENGTH),
      details: "D".repeat(MAX_DETAILS_LENGTH),
      proposedBy: "400000000000000002",
    },
    date: { value: "2030-12-28 09:00", label: "Wed, 28 Dec 2030 · 09:00" },
    threadId: "60000000000000000000",
    eventId: "70000000000000000000",
    mapPictureKey: null,
    completedAt: 1_900_000_000_000,
    locationPoll: { channelId: "300", messageId: "701" },
    datePoll: { channelId: "300", messageId: "702" },
  });

  it("stays within Discord's limits with ten hikes at the longest label and details, each with a thread and an event", () => {
    const components = renderHikeLog(
      {
        hikes: Array.from({ length: HIKES_PER_PAGE }, (_, i) => longest(i)),
        page: 500,
        pages: 1000,
        total: 9999,
      },
      "2".repeat(20),
      `https://hiking.bitcru.sh/calendar/${"2".repeat(20)}/${"s".repeat(43)}.ics`,
    );
    const all = nodes(components);
    expect(all.length).toBeLessThanOrEqual(MAX_MESSAGE_COMPONENTS);
    const length = all.reduce((sum, c) => sum + (c.content?.length ?? 0), 0);
    expect(length).toBeLessThanOrEqual(MAX_MESSAGE_TEXT);
    const shown = text(components);
    expect(shown).toContain(`${"D".repeat(LOG_DETAILS_CAP - 1)}…`);
    expect(shown).not.toContain("D".repeat(LOG_DETAILS_CAP));
    expect(shown).toContain(`**${"L".repeat(MAX_LABEL_LENGTH)}**`);
    expect(buttons(components)).toHaveLength(2);
  });
});

describe("the web view's hike log", () => {
  const guildId = "200000000000004001";

  async function page(n: number, pageSize = 10) {
    const result = await env.GUILD_HIKE.get(
      env.GUILD_HIKE.idFromName(guildId),
    ).webView({ guildId, userId: STRANGER, page: n, pageSize });
    if (result.kind !== "view") throw new Error(`no view: ${result.kind}`);
    return result.view.log;
  }

  it("pages 12 hikes 10 at a time, newest first, with the total", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      discordFetch({
        id: guildId,
        ownerId: "400000000000000001",
        members: { [STRANGER]: [] },
      }),
    );
    await runInDurableObject(
      env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId)),
      (_instance, state) => {
        const store = new PollStore(state.storage);
        seed(store, 12);
        const [newest] = store.listHikes({ limit: 1, offset: 0 });
        store.setRoundThread(newest?.roundId ?? 0, "600000000000000001");
        store.setRoundEvent(newest?.roundId ?? 0, "600000000000000002");
      },
    );

    const first = await page(1);
    expect(first).toMatchObject({ page: 1, pageSize: 10, pages: 2, total: 12 });
    expect(first.entries.map((e) => e.location.label)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Hike ${String(12 - i)}`),
    );
    expect(first.entries[0]).toEqual({
      roundId: expect.any(Number) as number,
      location: { label: "Hike 12", details: null, proposedBy: "u-proposer" },
      date: { value: "2030-01-12 11:00", label: "Sat, 12 Jan 2030 · 11:00" },
      threadUrl: `https://discord.com/channels/${guildId}/600000000000000001`,
      eventUrl: `https://discord.com/events/${guildId}/600000000000000002`,
      completedAt: expect.any(Number) as number,
    });
    expect(first.entries[1]).toMatchObject({ threadUrl: null, eventUrl: null });

    const second = await page(2);
    expect(second).toMatchObject({ page: 2, pages: 2, total: 12 });
    expect(second.entries.map((e) => e.location.label)).toEqual([
      "Hike 2",
      "Hike 1",
    ]);
    expect((await page(9)).page).toBe(2);
    expect((await page(0)).page).toBe(1);

    const fives = await page(2, 5);
    expect(fives).toMatchObject({ page: 2, pageSize: 5, pages: 3, total: 12 });
    expect(fives.entries.map((e) => e.location.label)).toEqual([
      "Hike 7",
      "Hike 6",
      "Hike 5",
      "Hike 4",
      "Hike 3",
    ]);
    expect((await page(9, 5)).page).toBe(3);
  });
});
