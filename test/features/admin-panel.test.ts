import { env } from "cloudflare:workers";
import {
  ApplicationCommandOptionType,
  ButtonStyle,
  ChannelType,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
  TextInputStyle,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
  type APIModalSubmitInteraction,
} from "discord-api-types/v10";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ADMIN_PANEL_FIELDS,
  ADMIN_PANEL_IDS,
  POLL_CONTROL_IDS,
  actionButtons,
  renderAdminPanel,
  renderAdminSettings,
  type PollAnnouncement,
} from "../../src/features/admin-panel";
import type { HikeDayStatus } from "../../src/features/hike-day-state";
import type { HikeEventStatus } from "../../src/features/hike-event-state";
import type { HikeThreadStatus } from "../../src/features/hike-thread-state";
import type { PollView, RoundView } from "../../src/polls/store";
import { GuildConfig, type GuildSettings } from "../../src/guild/config";
import {
  ADMIN_ONLY_MESSAGE,
  ADMIN_ONLY_NO_ROLE_MESSAGE,
} from "../../src/guild/permissions";
import {
  callWorker,
  commandInteraction,
  componentInteraction,
  createSigner,
  modalInteraction,
  signedRequest,
  type Signer,
} from "../helpers";
import { runInDurableObject } from "cloudflare:test";

const OWNER = "400000000000000001";
const ADMIN = "400000000000000002";
const STRANGER = "400000000000000003";
const ROLE = "500000000000000001";
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";

/** Discord's limits on one message: components in total, and text length. */
const MAX_COMPONENTS = 40;
const MAX_TEXT = 4000;

const EMPTY: GuildSettings = {
  adminRoleId: null,
  voteChannelId: null,
  announceChannelId: null,
  forumChannelId: null,
  ownerId: null,
  ownerFetchedAt: null,
  timezone: "America/Los_Angeles",
};
const COMPLETE: GuildSettings = {
  ...EMPTY,
  adminRoleId: ROLE,
  voteChannelId: TEXT,
  announceChannelId: NEWS,
  forumChannelId: FORUM,
};

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});

// Every guild in these tests is owned by OWNER.
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(Response.json({ id: "1", owner_id: OWNER })),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface Node {
  type: number;
  content?: string;
  components?: Node[];
  component?: Node;
  accessory?: Node;
}

/** Every component in `components`, nested ones included. */
function flatten(components: readonly Node[]): Node[] {
  return components.flatMap((c) => [
    c,
    ...flatten(c.components ?? []),
    ...flatten(c.component ? [c.component] : []),
    ...flatten(c.accessory ? [c.accessory] : []),
  ]);
}

function asNodes(components: APIMessageTopLevelComponent[]): Node[] {
  return components;
}

function text(components: readonly Node[]): string {
  return flatten(components)
    .map((c) => c.content ?? "")
    .join("\n");
}

function find(
  components: readonly Node[],
  customId: string,
): Record<string, unknown> | undefined {
  return flatten(components).find(
    (c) => (c as { custom_id?: string }).custom_id === customId,
  ) as Record<string, unknown> | undefined;
}

function expectWithinLimits(components: APIMessageTopLevelComponent[]) {
  const nodes = asNodes(components);
  expect(flatten(nodes).length).toBeLessThanOrEqual(MAX_COMPONENTS);
  expect(text(nodes).length).toBeLessThanOrEqual(MAX_TEXT);
}

function member(userId: string, roles: string[] = []) {
  return { user: { id: userId }, roles };
}

function hikeAdmin(
  guildId: string,
  userId: string,
  roles: string[] = [],
): APIChatInputApplicationCommandInteraction {
  const interaction = commandInteraction("hike", guildId);
  Object.assign(interaction, { member: member(userId, roles) });
  Object.assign(interaction.data, {
    options: [{ type: ApplicationCommandOptionType.Subcommand, name: "admin" }],
  });
  return interaction;
}

function click(
  customId: string,
  guildId: string,
  userId: string,
  roles: string[] = [],
): APIMessageComponentInteraction {
  const interaction = componentInteraction(customId, guildId);
  Object.assign(interaction, { member: member(userId, roles) });
  return interaction;
}

function submitTimezone(
  guildId: string,
  userId: string,
  value: string,
  fromMessage = true,
): APIModalSubmitInteraction {
  const interaction = modalInteraction(ADMIN_PANEL_IDS.timezone, guildId);
  Object.assign(interaction, {
    member: member(userId),
    ...(fromMessage
      ? { message: { id: "800000000000000001", components: [] } }
      : {}),
  });
  Object.assign(interaction.data, {
    components: [
      {
        type: ComponentType.Label,
        component: {
          type: ComponentType.TextInput,
          custom_id: ADMIN_PANEL_FIELDS.timezone,
          value,
        },
      },
    ],
  });
  return interaction;
}

function pickRole(
  guildId: string,
  userId: string,
  roleId: string | null,
): APIMessageComponentInteraction {
  const interaction = click(ADMIN_PANEL_IDS.role, guildId, userId);
  Object.assign(interaction.data, {
    component_type: ComponentType.RoleSelect,
    values: roleId === null ? [] : [roleId],
    resolved: {
      roles:
        roleId === null ? {} : { [roleId]: { id: roleId, name: "Hike lead" } },
    },
  });
  return interaction;
}

function pickChannel(
  customId: string,
  guildId: string,
  userId: string,
  channelId: string | null,
  resolved: Record<string, { id: string; type: ChannelType }> = channelId ===
  null
    ? {}
    : { [channelId]: { id: channelId, type: ChannelType.GuildText } },
): APIMessageComponentInteraction {
  const interaction = click(customId, guildId, userId);
  Object.assign(interaction.data, {
    component_type: ComponentType.ChannelSelect,
    values: channelId === null ? [] : [channelId],
    resolved: { channels: resolved },
  });
  return interaction;
}

async function send(interaction: unknown): Promise<APIInteractionResponse> {
  const response = await callWorker(
    signer,
    await signedRequest(signer, interaction),
  );
  expect(response.status).toBe(200);
  return response.json();
}

interface MessageResponse {
  type: InteractionResponseType;
  data: { flags?: number; components: Node[]; allowed_mentions?: unknown };
}

function message(response: APIInteractionResponse): MessageResponse {
  return response as unknown as MessageResponse;
}

function settingsOf(guildId: string): Promise<GuildSettings> {
  return runInDurableObject(
    env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId)),
    (_instance, state) => new GuildConfig(state.storage).get(),
  );
}

describe("renderAdminPanel", () => {
  it("shows every setting as not set, and setup as incomplete, for a new guild", () => {
    const view = renderAdminPanel({ settings: EMPTY, round: null });
    const shown = text(asNodes(view));
    expect(shown).toContain("hikebot admin");
    expect(shown).toContain(
      "**Admin role:** not set (only the server owner can use this panel)",
    );
    expect(shown).toContain("**Voting channel:** not set");
    expect(shown).toContain("**Announcements channel:** not set");
    expect(shown).toContain("**Hike threads channel:** not set");
    expect(shown).toContain("Setup is not complete");
    expect(find(asNodes(view), ADMIN_PANEL_IDS.settings)).toMatchObject({
      style: ButtonStyle.Primary,
    });
    expect(find(asNodes(view), ADMIN_PANEL_IDS.refresh)).toBeDefined();
    expectWithinLimits(view);
  });

  it("shows the settings that are set as mentions, and setup as incomplete while a channel is missing", () => {
    const view = renderAdminPanel({
      settings: { ...EMPTY, adminRoleId: ROLE, voteChannelId: TEXT },
      round: null,
    });
    const shown = text(asNodes(view));
    expect(shown).toContain(`**Admin role:** <@&${ROLE}>`);
    expect(shown).toContain(`**Voting channel:** <#${TEXT}>`);
    expect(shown).toContain("**Announcements channel:** not set");
    expect(shown).toContain("Setup is not complete");
    expectWithinLimits(view);
  });

  it("shows setup as complete once the three channels are set", () => {
    const view = renderAdminPanel({ settings: COMPLETE, round: null });
    const shown = text(asNodes(view));
    expect(shown).toContain(`**Announcements channel:** <#${NEWS}>`);
    expect(shown).toContain(`**Hike threads channel:** <#${FORUM}>`);
    expect(shown).toContain("Setup is complete.");
    expect(find(asNodes(view), ADMIN_PANEL_IDS.settings)).toMatchObject({
      style: ButtonStyle.Secondary,
    });
    expectWithinLimits(view);
  });

  it("offers Settings and Refresh as the actions", () => {
    expect(
      actionButtons({ settings: EMPTY, round: null }).map((b) => b.custom_id),
    ).toEqual([ADMIN_PANEL_IDS.settings, ADMIN_PANEL_IDS.refresh]);
  });

  it("names the settings setup still needs and offers no start", () => {
    const view = renderAdminPanel({
      settings: { ...EMPTY, voteChannelId: TEXT },
      round: null,
    });
    expect(text(asNodes(view))).toContain(
      "Setup is not complete: set the announcements channel and hike threads channel under Settings.",
    );
    expect(
      find(asNodes(view), POLL_CONTROL_IDS.startLocationVote),
    ).toBeUndefined();
  });

  it("offers Start location vote once setup is complete and no round is active", () => {
    const state = { settings: COMPLETE, round: null };
    expect(actionButtons(state).map((b) => b.custom_id)).toEqual([
      POLL_CONTROL_IDS.startLocationVote,
      ADMIN_PANEL_IDS.settings,
      ADMIN_PANEL_IDS.refresh,
    ]);
    expect(text(asNodes(renderAdminPanel(state)))).toContain(
      "No hike is being planned.",
    );
  });

  it("shows the open vote's tallies with Close location vote and Cancel round, within limits", () => {
    const poll = votingPoll(25);
    const state = { settings: COMPLETE, round: votingRound(poll) };
    expect(actionButtons(state).map((b) => b.custom_id)).toEqual([
      POLL_CONTROL_IDS.closePoll(poll.id),
      POLL_CONTROL_IDS.cancelRound(7),
      ADMIN_PANEL_IDS.settings,
      ADMIN_PANEL_IDS.refresh,
    ]);
    const view = renderAdminPanel(state, "x".repeat(300));
    const shown = text(asNodes(view));
    expect(shown).toContain(`**The location vote is open** in <#${TEXT}>.`);
    expect(shown).toContain(`1. ${"L".repeat(78)}24: 24 votes`);
    expect(shown).toContain("30 members have voted.");
    expectWithinLimits(view);
  });

  it("shows the decided location and Cancel round once the location vote is closed", () => {
    const poll: PollView = {
      ...votingPoll(2),
      status: "closed",
      winnerOptionId: 1,
      tieBroken: true,
      tiedOptionIds: [1, 2],
    };
    const state = {
      settings: COMPLETE,
      round: {
        ...votingRound(poll),
        status: "location_decided" as const,
        locationOptionId: 1,
      },
    };
    expect(actionButtons(state).map((b) => b.custom_id)).toEqual([
      POLL_CONTROL_IDS.startDateVote,
      POLL_CONTROL_IDS.cancelRound(7),
      ADMIN_PANEL_IDS.settings,
      ADMIN_PANEL_IDS.refresh,
    ]);
    expect(text(asNodes(renderAdminPanel(state)))).toContain(
      `**Location decided:** ${"L".repeat(78)}00 (0 votes), drawn at random from a tie.`,
    );
  });

  it("shows the decided location, the date vote's tallies, Close date vote and Cancel round while the date vote is open", () => {
    const location: PollView = {
      ...votingPoll(2),
      status: "closed",
      winnerOptionId: 2,
    };
    const dates = datePoll(25);
    const state = {
      settings: COMPLETE,
      round: {
        ...votingRound(location),
        status: "date_voting" as const,
        locationOptionId: 2,
        datePoll: dates,
      },
    };
    expect(actionButtons(state).map((b) => b.custom_id)).toEqual([
      POLL_CONTROL_IDS.closePoll(dates.id),
      POLL_CONTROL_IDS.cancelRound(7),
      ADMIN_PANEL_IDS.settings,
      ADMIN_PANEL_IDS.refresh,
    ]);
    const view = renderAdminPanel(state, "x".repeat(300));
    const shown = text(asNodes(view));
    expect(shown).toContain(`**Location decided:** ${"L".repeat(78)}01`);
    expect(shown).toContain(`**The date vote is open** in <#${TEXT}>.`);
    expect(shown).toContain("1. Sat, 25 Dec 2027 · 09:00: 24 votes");
    expect(
      flatten(asNodes(view)).some(
        (c) => (c as { label?: string }).label === "Close date vote",
      ),
    ).toBe(true);
    expectWithinLimits(view);
  });

  it("sums up the last hike once its round is complete, and offers Start location vote", () => {
    const location: PollView = {
      ...votingPoll(2),
      status: "closed",
      winnerOptionId: 2,
    };
    const dates: PollView = { ...datePoll(3), status: "closed" };
    const finished: RoundView = {
      ...votingRound(location),
      status: "complete",
      locationOptionId: 2,
      dateOptionId: 12,
      datePoll: dates,
    };
    const state = { settings: COMPLETE, round: null, finished };
    expect(actionButtons(state).map((b) => b.custom_id)).toEqual([
      POLL_CONTROL_IDS.startLocationVote,
      ADMIN_PANEL_IDS.settings,
      ADMIN_PANEL_IDS.refresh,
    ]);
    const shown = text(asNodes(renderAdminPanel(state)));
    expect(shown).toContain(
      `**Last hike:** **${"L".repeat(78)}01** on **Sun, 2 Dec 2027 · 09:00**.`,
    );
    expect(shown).toContain("No hike is being planned. Start a location vote.");
  });

  describe("the last hike's thread", () => {
    const location: PollView = {
      ...votingPoll(2),
      status: "closed",
      winnerOptionId: 2,
    };
    const finished: RoundView = {
      ...votingRound(location),
      status: "complete",
      locationOptionId: 2,
      dateOptionId: 12,
      datePoll: { ...datePoll(3), status: "closed" },
    };
    const panel = (
      thread: HikeThreadStatus,
      threadId: string | null = null,
    ) => {
      const state = {
        settings: COMPLETE,
        round: null,
        finished: { ...finished, threadId },
        thread,
      };
      return {
        buttons: actionButtons(state).map((b) => b.custom_id),
        shown: text(asNodes(renderAdminPanel(state))),
        view: renderAdminPanel(state, "x".repeat(300)),
      };
    };

    it("links the thread once it exists, with no Create hike thread", () => {
      const { buttons, shown } = panel(
        { state: "created", threadId: "900000000000000001" },
        "900000000000000001",
      );
      expect(shown).toContain("**Hike thread:** <#900000000000000001>");
      expect(buttons).toEqual([
        POLL_CONTROL_IDS.startLocationVote,
        ADMIN_PANEL_IDS.settings,
        ADMIN_PANEL_IDS.refresh,
      ]);
    });

    it("shows why it failed and offers Create hike thread for that round", () => {
      const reason = `Could not create the hike thread in <#${FORUM}>: ${"r".repeat(400)}`;
      const { buttons, shown, view } = panel({ state: "failed", reason });
      expect(shown).toContain(`**Hike thread:** not created. ${reason}`);
      expect(buttons).toEqual([
        POLL_CONTROL_IDS.startLocationVote,
        POLL_CONTROL_IDS.createHikeThread(finished.id),
        ADMIN_PANEL_IDS.settings,
        ADMIN_PANEL_IDS.refresh,
      ]);
      expectWithinLimits(view);
    });

    it("offers Create hike thread when no attempt finished", () => {
      const { buttons, shown } = panel({ state: "missing" });
      expect(shown).toContain(
        "**Hike thread:** not created. Click Create hike thread to create it.",
      );
      expect(buttons).toContain(POLL_CONTROL_IDS.createHikeThread(finished.id));
    });

    it("says a cut-off creation is not confirmed and offers Create hike thread", () => {
      const { buttons, shown } = panel({ state: "unconfirmed" });
      expect(shown).toContain(
        "**Hike thread:** not confirmed: creating it was cut off, so it may or may not exist. Check the hike threads channel, and click Create hike thread only if it is missing.",
      );
      expect(buttons).toContain(POLL_CONTROL_IDS.createHikeThread(finished.id));
    });

    it("offers no button while the thread is being created", () => {
      const { buttons, shown } = panel({ state: "creating" });
      expect(shown).toContain("**Hike thread:** being created.");
      expect(buttons).not.toContain(
        POLL_CONTROL_IDS.createHikeThread(finished.id),
      );
    });

    describe("and its event", () => {
      const thread: HikeThreadStatus = {
        state: "created",
        threadId: "900000000000000001",
      };
      const withEvent = (event: HikeEventStatus) => {
        const state = {
          settings: COMPLETE,
          round: null,
          finished: { ...finished, threadId: thread.threadId },
          thread,
          event,
        };
        return {
          buttons: actionButtons(state).map((b) => b.custom_id),
          shown: text(asNodes(renderAdminPanel(state))),
          view: renderAdminPanel(state, "x".repeat(300)),
        };
      };

      it("says it was created, with no Create hike event", () => {
        const { buttons, shown } = withEvent({
          state: "created",
          eventId: "950000000000000001",
        });
        expect(shown).toContain("**Hike event:** created.");
        expect(buttons).toEqual([
          POLL_CONTROL_IDS.startLocationVote,
          ADMIN_PANEL_IDS.settings,
          ADMIN_PANEL_IDS.refresh,
        ]);
      });

      it("shows why it failed and offers Create hike event for that round", () => {
        const reason = `Could not create the hike event: ${"r".repeat(400)} Give the bot the Create Events permission in the server's settings, then click Create hike event.`;
        const { buttons, shown, view } = withEvent({ state: "failed", reason });
        expect(shown).toContain(`**Hike event:** not created. ${reason}`);
        expect(buttons).toEqual([
          POLL_CONTROL_IDS.startLocationVote,
          POLL_CONTROL_IDS.createHikeEvent(finished.id),
          ADMIN_PANEL_IDS.settings,
          ADMIN_PANEL_IDS.refresh,
        ]);
        expectWithinLimits(view);
      });

      it("offers Create hike event when no attempt finished", () => {
        const { buttons, shown } = withEvent({ state: "missing" });
        expect(shown).toContain(
          "**Hike event:** not created. Click Create hike event to create it.",
        );
        expect(buttons).toContain(
          POLL_CONTROL_IDS.createHikeEvent(finished.id),
        );
      });

      it("says a cut-off creation is not confirmed and offers Create hike event", () => {
        const { buttons, shown } = withEvent({ state: "unconfirmed" });
        expect(shown).toContain(
          "**Hike event:** not confirmed: creating it was cut off, so it may or may not exist. Check the server's events, and click Create hike event only if it is missing.",
        );
        expect(buttons).toContain(
          POLL_CONTROL_IDS.createHikeEvent(finished.id),
        );
      });

      it("offers no button while it is being created", () => {
        const { buttons, shown } = withEvent({ state: "creating" });
        expect(shown).toContain("**Hike event:** being created.");
        expect(buttons).not.toContain(
          POLL_CONTROL_IDS.createHikeEvent(finished.id),
        );
      });

      it("says the start has passed, with no retry", () => {
        const { buttons, shown } = withEvent({ state: "past" });
        expect(shown).toContain(
          "**Hike event:** The hike's start time has passed, so no event was created.",
        );
        expect(buttons).not.toContain(
          POLL_CONTROL_IDS.createHikeEvent(finished.id),
        );
      });

      it("keeps both retries and the panel within Discord's limits when both failed", () => {
        const state = {
          settings: COMPLETE,
          round: null,
          finished,
          thread: { state: "failed", reason: "t".repeat(500) } as const,
          event: { state: "failed", reason: "e".repeat(500) } as const,
        };
        expect(actionButtons(state).map((b) => b.custom_id)).toEqual([
          POLL_CONTROL_IDS.startLocationVote,
          POLL_CONTROL_IDS.createHikeThread(finished.id),
          POLL_CONTROL_IDS.createHikeEvent(finished.id),
          ADMIN_PANEL_IDS.settings,
          ADMIN_PANEL_IDS.refresh,
        ]);
        expectWithinLimits(renderAdminPanel(state, "x".repeat(300)));
      });
    });

    describe("and its hike-day announcement", () => {
      const thread: HikeThreadStatus = {
        state: "created",
        threadId: "900000000000000001",
      };
      const at = Date.UTC(2027, 5, 12, 14);
      const withHikeDay = (
        status: HikeDayStatus,
        settings: GuildSettings = COMPLETE,
      ) => {
        const state = {
          settings,
          round: null,
          finished: { ...finished, threadId: thread.threadId },
          thread,
          hikeDay: { status, at },
        };
        return {
          buttons: actionButtons(state).map((b) => b.custom_id),
          shown: text(asNodes(renderAdminPanel(state))),
        };
      };

      it("says when and where it will be posted, with no button", () => {
        const { buttons, shown } = withHikeDay({ state: "planned" });
        expect(shown).toContain(
          `**Hike-day announcement:** <t:${String(at / 1000)}:f> in <#${COMPLETE.announceChannelId ?? ""}>.`,
        );
        expect(buttons).not.toContain(
          POLL_CONTROL_IDS.postHikeDay(finished.id),
        );
      });

      it("says it will not be posted while no announcements channel is set", () => {
        const { shown } = withHikeDay(
          { state: "planned" },
          { ...COMPLETE, announceChannelId: null },
        );
        expect(shown).toContain(
          `**Hike-day announcement:** due <t:${String(at / 1000)}:f>, but no announcements channel is set, so it will not be posted. Pick one under Settings.`,
        );
      });

      it("shows why it failed and offers Post hike-day announcement", () => {
        const { buttons, shown } = withHikeDay({
          state: "failed",
          reason: "Discord said no.",
        });
        expect(shown).toContain(
          "**Hike-day announcement:** not posted. Discord said no.",
        );
        expect(buttons).toEqual([
          POLL_CONTROL_IDS.startLocationVote,
          POLL_CONTROL_IDS.postHikeDay(finished.id),
          ADMIN_PANEL_IDS.settings,
          ADMIN_PANEL_IDS.refresh,
        ]);
      });

      it("says a cut-off post is not confirmed and offers Post hike-day announcement", () => {
        const { buttons, shown } = withHikeDay({ state: "unconfirmed" });
        expect(shown).toContain(
          "**Hike-day announcement:** not confirmed: posting it was cut off, so it may or may not have been posted. Check the announcements channel, and click Post hike-day announcement only if it is missing.",
        );
        expect(buttons).toContain(POLL_CONTROL_IDS.postHikeDay(finished.id));
      });

      it("offers no button while it is being posted or once it is posted", () => {
        const posting = withHikeDay({ state: "posting" });
        expect(posting.shown).toContain(
          "**Hike-day announcement:** being posted.",
        );
        const posted = withHikeDay({
          state: "posted",
          channelId: "300000000000000002",
          messageId: "960000000000000001",
        });
        expect(posted.shown).toContain(
          "**Hike-day announcement:** posted in <#300000000000000002>.",
        );
        for (const { buttons } of [posting, posted]) {
          expect(buttons).not.toContain(
            POLL_CONTROL_IDS.postHikeDay(finished.id),
          );
        }
      });

      it("keeps every retry and the panel within Discord's limits when all failed", () => {
        const state = {
          settings: COMPLETE,
          round: null,
          finished,
          thread: { state: "failed", reason: "t".repeat(500) } as const,
          event: { state: "failed", reason: "e".repeat(500) } as const,
          hikeDay: {
            status: { state: "failed", reason: "h".repeat(500) } as const,
            at,
          },
        };
        expect(actionButtons(state).map((b) => b.custom_id)).toEqual([
          POLL_CONTROL_IDS.startLocationVote,
          POLL_CONTROL_IDS.createHikeThread(finished.id),
          POLL_CONTROL_IDS.createHikeEvent(finished.id),
          POLL_CONTROL_IDS.postHikeDay(finished.id),
          ADMIN_PANEL_IDS.settings,
          ADMIN_PANEL_IDS.refresh,
        ]);
        expectWithinLimits(renderAdminPanel(state, "x".repeat(300)));
      });
    });

    describe("and its announcements", () => {
      const thread: HikeThreadStatus = {
        state: "created",
        threadId: "900000000000000001",
      };
      const withAnnouncements = (announcements: PollAnnouncement[]) => {
        const state = {
          settings: COMPLETE,
          round: null,
          finished: { ...finished, threadId: thread.threadId },
          thread,
          announcements,
        };
        return {
          buttons: actionButtons(state).map((b) => b.custom_id),
          shown: text(asNodes(renderAdminPanel(state))),
          view: renderAdminPanel(state, "x".repeat(300)),
        };
      };

      it("shows why one failed and offers Announce for that vote", () => {
        const reason = `Could not post the announcement in <#${NEWS}>: ${"r".repeat(400)}`;
        const { buttons, shown, view } = withAnnouncements([
          { pollId: 3, kind: "date", status: { state: "failed", reason } },
        ]);
        expect(shown).toContain(
          `**Date vote announcement:** not posted. ${reason}`,
        );
        expect(buttons).toEqual([
          POLL_CONTROL_IDS.startLocationVote,
          POLL_CONTROL_IDS.announce(3),
          ADMIN_PANEL_IDS.settings,
          ADMIN_PANEL_IDS.refresh,
        ]);
        expectWithinLimits(view);
      });

      it("says a cut-off post is not confirmed and offers Announce", () => {
        const { buttons, shown } = withAnnouncements([
          { pollId: 1, kind: "location", status: { state: "unconfirmed" } },
        ]);
        expect(shown).toContain(
          "**Location vote announcement:** not confirmed: posting it was cut off, so it may or may not have been posted. Check the announcements channel, and click Announce location vote only if it is missing.",
        );
        expect(buttons).toContain(POLL_CONTROL_IDS.announce(1));
      });

      it("offers no button while one is being posted", () => {
        const { buttons, shown } = withAnnouncements([
          { pollId: 3, kind: "date", status: { state: "posting" } },
        ]);
        expect(shown).toContain("**Date vote announcement:** being posted.");
        expect(buttons).not.toContain(POLL_CONTROL_IDS.announce(3));
      });

      it("offers Announce during a round whose location announcement failed", () => {
        const state = {
          settings: COMPLETE,
          round: {
            ...votingRound(location),
            status: "location_decided" as const,
            locationOptionId: 2,
          },
          announcements: [
            {
              pollId: 1,
              kind: "location" as const,
              status: { state: "failed" as const, reason: "No channel." },
            },
          ],
        };
        expect(text(asNodes(renderAdminPanel(state)))).toContain(
          "**Location vote announcement:** not posted. No channel.",
        );
        expect(actionButtons(state).map((b) => b.custom_id)).toContain(
          POLL_CONTROL_IDS.announce(1),
        );
      });
    });
  });

  it("shows the time zone and the time there now", () => {
    // 2026-11-18 19:42 UTC is Wednesday 11:42 in Los Angeles.
    const now = Date.UTC(2026, 10, 18, 19, 42);
    expect(
      text(asNodes(renderAdminPanel({ settings: EMPTY, round: null, now }))),
    ).toContain("**Time zone:** America/Los_Angeles · now Wed 11:42");
    expect(
      text(
        asNodes(
          renderAdminPanel({
            settings: { ...EMPTY, timezone: "Asia/Kolkata" },
            round: null,
            now,
          }),
        ),
      ),
    ).toContain("**Time zone:** Asia/Kolkata · now Thu 01:12");
  });

  it("shows a notice above the settings", () => {
    const view = renderAdminPanel({ settings: EMPTY, round: null }, "Saved.");
    expect(text(asNodes(view))).toContain("Saved.");
  });
});

/** An open location poll with `n` options at the longest label. */
function votingPoll(n: number): PollView {
  return {
    id: 3,
    roundId: 7,
    kind: "location",
    status: "open",
    channelId: TEXT,
    messageId: "700000000000000001",
    winnerOptionId: null,
    tieBroken: false,
    tiedOptionIds: [],
    openedBy: OWNER,
    openedAt: 0,
    closedBy: null,
    closedAt: null,
    options: Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      pollId: 3,
      label: `${"L".repeat(78)}${String(i).padStart(2, "0")}`,
      details: "D".repeat(300),
      dateValue: null,
      proposedBy: OWNER,
      createdAt: 0,
      votes: i,
    })),
    voterCount: 30,
    viewerVotes: [],
  };
}

/** An open date poll with `n` dates at the longest label, in date order. */
function datePoll(n: number): PollView {
  return {
    ...votingPoll(0),
    id: 4,
    kind: "date",
    options: Array.from({ length: n }, (_, i) => ({
      id: i + 11,
      pollId: 4,
      label: `${["Sat", "Sun", "Mon"][i % 3] ?? ""}, ${String(i + 1)} Dec 2027 · 09:00`,
      details: null,
      dateValue: `2027-12-${String(i + 1).padStart(2, "0")} 09:00`,
      proposedBy: OWNER,
      createdAt: 0,
      votes: i,
    })),
  };
}

function votingRound(poll: PollView): RoundView {
  return {
    id: 7,
    status: "location_voting",
    locationOptionId: null,
    dateOptionId: null,
    threadId: null,
    eventId: null,
    dayOf: null,
    startedBy: OWNER,
    startedAt: 0,
    endedBy: null,
    endedAt: null,
    locationPoll: poll,
    datePoll: null,
  };
}

describe("renderAdminSettings", () => {
  it("has a role select and three channel selects without defaults for a new guild", () => {
    const view = renderAdminSettings({ settings: EMPTY, round: null });
    const nodes = asNodes(view);
    expect(find(nodes, ADMIN_PANEL_IDS.role)).toMatchObject({
      type: ComponentType.RoleSelect,
      min_values: 0,
      max_values: 1,
    });
    expect(find(nodes, ADMIN_PANEL_IDS.role)).not.toHaveProperty(
      "default_values",
    );
    expect(find(nodes, ADMIN_PANEL_IDS.voteChannel)).toMatchObject({
      type: ComponentType.ChannelSelect,
      channel_types: [ChannelType.GuildText],
    });
    expect(find(nodes, ADMIN_PANEL_IDS.announceChannel)).toMatchObject({
      type: ComponentType.ChannelSelect,
      channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
    });
    expect(find(nodes, ADMIN_PANEL_IDS.forumChannel)).toMatchObject({
      type: ComponentType.ChannelSelect,
      channel_types: [ChannelType.GuildForum],
    });
    expect(find(nodes, ADMIN_PANEL_IDS.back)).toBeDefined();
    expectWithinLimits(view);
  });

  it("shows the time zone, the time there and Set time zone", () => {
    const view = renderAdminSettings({
      settings: { ...COMPLETE, timezone: "Europe/Berlin" },
      round: null,
      now: Date.UTC(2026, 10, 18, 19, 42),
    });
    const nodes = asNodes(view);
    expect(text(nodes)).toContain(
      "**Time zone:** Europe/Berlin · now Wed 20:42",
    );
    expect(text(nodes)).toContain(
      "a date typed without a time starts at 11:00",
    );
    expect(find(nodes, ADMIN_PANEL_IDS.timezone)).toMatchObject({
      type: ComponentType.Button,
      label: "Set time zone",
    });
    expectWithinLimits(view);
  });

  it("shows each current value as the select's default", () => {
    const view = renderAdminSettings(
      { settings: COMPLETE, round: null },
      "Saved.",
    );
    const nodes = asNodes(view);
    expect(find(nodes, ADMIN_PANEL_IDS.role)).toMatchObject({
      default_values: [{ id: ROLE, type: "role" }],
    });
    expect(find(nodes, ADMIN_PANEL_IDS.voteChannel)).toMatchObject({
      default_values: [{ id: TEXT, type: "channel" }],
    });
    expect(find(nodes, ADMIN_PANEL_IDS.announceChannel)).toMatchObject({
      default_values: [{ id: NEWS, type: "channel" }],
    });
    expect(find(nodes, ADMIN_PANEL_IDS.forumChannel)).toMatchObject({
      default_values: [{ id: FORUM, type: "channel" }],
    });
    expectWithinLimits(view);
  });
});

describe("the admin panel", () => {
  it("opens with /hike admin as an ephemeral Components V2 reply that pings no one", async () => {
    const reply = message(await send(hikeAdmin("panel-open", OWNER)));
    expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(reply.data.flags).toBe(
      MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    );
    expect(reply.data.allowed_mentions).toEqual({ parse: [] });
    expect(text(reply.data.components)).toContain("hikebot admin");
    expect(find(reply.data.components, ADMIN_PANEL_IDS.settings)).toBeDefined();
  });

  it("refuses a stranger before any admin role is set", async () => {
    const reply = message(await send(hikeAdmin("panel-stranger", STRANGER)));
    expect(reply.data.flags).toBe(
      MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    );
    expect(text(reply.data.components)).toBe(ADMIN_ONLY_NO_ROLE_MESSAGE);
  });

  it("switches to Settings, back with Back, and redraws with Refresh, in place", async () => {
    const guild = "panel-views";
    const settings = message(
      await send(click(ADMIN_PANEL_IDS.settings, guild, OWNER)),
    );
    expect(settings.type).toBe(InteractionResponseType.UpdateMessage);
    expect(find(settings.data.components, ADMIN_PANEL_IDS.role)).toBeDefined();

    const back = message(await send(click(ADMIN_PANEL_IDS.back, guild, OWNER)));
    expect(back.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(back.data.components)).toContain("hikebot admin");
    expect(find(back.data.components, ADMIN_PANEL_IDS.role)).toBeUndefined();

    const refresh = message(
      await send(click(ADMIN_PANEL_IDS.refresh, guild, OWNER)),
    );
    expect(refresh.type).toBe(InteractionResponseType.UpdateMessage);
    // The clock in the time zone line may have moved on between the two.
    const steady = (view: Node[]) =>
      JSON.stringify(view).replace(/ · now \w{3} \d\d:\d\d/, "");
    expect(steady(refresh.data.components)).toBe(steady(back.data.components));
  });

  it("saves each select and shows the saved values", async () => {
    const guild = "panel-save";
    let view = message(await send(pickRole(guild, OWNER, ROLE)));
    expect(text(view.data.components)).toContain(
      `Admin role set to <@&${ROLE}>.`,
    );
    expect(find(view.data.components, ADMIN_PANEL_IDS.role)).toMatchObject({
      default_values: [{ id: ROLE, type: "role" }],
    });

    view = message(
      await send(pickChannel(ADMIN_PANEL_IDS.voteChannel, guild, OWNER, TEXT)),
    );
    expect(text(view.data.components)).toContain(
      `Voting channel set to <#${TEXT}>.`,
    );
    view = message(
      await send(
        pickChannel(ADMIN_PANEL_IDS.announceChannel, guild, OWNER, NEWS, {
          [NEWS]: { id: NEWS, type: ChannelType.GuildAnnouncement },
        }),
      ),
    );
    expect(text(view.data.components)).toContain(
      `Announcements channel set to <#${NEWS}>.`,
    );
    view = message(
      await send(
        pickChannel(ADMIN_PANEL_IDS.forumChannel, guild, OWNER, FORUM, {
          [FORUM]: { id: FORUM, type: ChannelType.GuildForum },
        }),
      ),
    );
    expect(text(view.data.components)).toContain(
      `Hike threads channel set to <#${FORUM}>.`,
    );
    expect(
      find(view.data.components, ADMIN_PANEL_IDS.forumChannel),
    ).toMatchObject({ default_values: [{ id: FORUM, type: "channel" }] });

    expect(await settingsOf(guild)).toMatchObject({
      adminRoleId: ROLE,
      voteChannelId: TEXT,
      announceChannelId: NEWS,
      forumChannelId: FORUM,
    });
    const status = message(
      await send(click(ADMIN_PANEL_IDS.back, guild, OWNER)),
    );
    expect(text(status.data.components)).toContain("Setup is complete.");
  });

  it("clears the admin role when the role select is emptied", async () => {
    const guild = "panel-clear-role";
    await send(pickRole(guild, OWNER, ROLE));
    const view = message(await send(pickRole(guild, OWNER, null)));
    expect(text(view.data.components)).toContain(
      "Admin role cleared: only the server owner can use the panel.",
    );
    expect(find(view.data.components, ADMIN_PANEL_IDS.role)).not.toHaveProperty(
      "default_values",
    );
    expect((await settingsOf(guild)).adminRoleId).toBeNull();
  });

  it("refuses the @everyone role as the admin role", async () => {
    const guild = "600000000000000001";
    const view = message(await send(pickRole(guild, OWNER, guild)));
    expect(text(view.data.components)).toContain(
      "The @everyone role cannot be the admin role.",
    );
    expect((await settingsOf(guild)).adminRoleId).toBeNull();
  });

  it("refuses a channel of the wrong type", async () => {
    const guild = "panel-wrong-type";
    const view = message(
      await send(
        pickChannel(ADMIN_PANEL_IDS.forumChannel, guild, OWNER, TEXT, {
          [TEXT]: { id: TEXT, type: ChannelType.GuildText },
        }),
      ),
    );
    expect(text(view.data.components)).toContain(
      "That channel cannot be the hike threads channel.",
    );
    expect((await settingsOf(guild)).forumChannelId).toBeNull();
  });

  it("refuses a channel missing from resolved", async () => {
    const guild = "panel-unresolved";
    const view = message(
      await send(
        pickChannel(ADMIN_PANEL_IDS.voteChannel, guild, OWNER, TEXT, {}),
      ),
    );
    expect(text(view.data.components)).toContain(
      "That channel cannot be the voting channel.",
    );
    expect((await settingsOf(guild)).voteChannelId).toBeNull();
  });

  it("shows the time zone in both views as it was drawn", async () => {
    const guild = "panel-timezone-views";
    const status = message(await send(hikeAdmin(guild, OWNER)));
    expect(text(status.data.components)).toMatch(
      /\*\*Time zone:\*\* America\/Los_Angeles · now (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d/,
    );
    const settings = message(
      await send(click(ADMIN_PANEL_IDS.settings, guild, OWNER)),
    );
    expect(text(settings.data.components)).toContain(
      "**Time zone:** America/Los_Angeles · now ",
    );
  });

  it("opens Set time zone as a modal with a Label, prefilled with the zone", async () => {
    const guild = "panel-timezone-modal";
    let reply = (await send(
      click(ADMIN_PANEL_IDS.timezone, guild, OWNER),
    )) as unknown as {
      type: InteractionResponseType;
      data: { custom_id: string; title: string; components: Node[] };
    };
    expect(reply.type).toBe(InteractionResponseType.Modal);
    expect(reply.data.custom_id).toBe(ADMIN_PANEL_IDS.timezone);
    expect(reply.data.title).toBe("Set time zone");
    expect(reply.data.components).toMatchObject([
      {
        type: ComponentType.Label,
        label: "Time zone",
        component: {
          type: ComponentType.TextInput,
          custom_id: ADMIN_PANEL_FIELDS.timezone,
          style: TextInputStyle.Short,
          required: true,
          value: "America/Los_Angeles",
        },
      },
    ]);

    await send(submitTimezone(guild, OWNER, "Europe/Berlin"));
    reply = (await send(
      click(ADMIN_PANEL_IDS.timezone, guild, OWNER),
    )) as unknown as typeof reply;
    expect(reply.data.components).toMatchObject([
      { component: { value: "Europe/Berlin" } },
    ]);
  });

  it.each([
    ["america/denver", "America/Denver"],
    ["MT", "America/Denver"],
    ["Europe/Berlin", "Europe/Berlin"],
    [" pt ", "America/Los_Angeles"],
    ["utc", "UTC"],
  ])("stores %j as %s and redraws Settings in place", async (typed, zone) => {
    const guild = `panel-timezone-${typed}`;
    const view = message(await send(submitTimezone(guild, OWNER, typed)));
    expect(view.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(view.data.components)).toContain(`Time zone set to ${zone}.`);
    expect(text(view.data.components)).toContain(
      `**Time zone:** ${zone} · now `,
    );
    expect((await settingsOf(guild)).timezone).toBe(zone);
  });

  it("answers a modal sent without its message with the settings as an ephemeral reply", async () => {
    const guild = "panel-timezone-no-message";
    const view = message(
      await send(submitTimezone(guild, OWNER, "Europe/Berlin", false)),
    );
    expect(view.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(view.data.flags).toBe(
      MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    );
    expect((await settingsOf(guild)).timezone).toBe("Europe/Berlin");
  });

  it.each([
    [
      "Mars/Olympus",
      "`Mars/Olympus` is not a time zone, so it is still Asia/Kolkata.",
    ],
    ["   ", "No time zone was entered, so it is still Asia/Kolkata."],
    ["", "No time zone was entered, so it is still Asia/Kolkata."],
    ["+05:00", "`+05:00` is not a time zone"],
  ])(
    "changes nothing for %j and says what would work",
    async (typed, start) => {
      const guild = `panel-timezone-bad-${typed}`;
      await send(submitTimezone(guild, OWNER, "Asia/Kolkata"));
      const reply = message(await send(submitTimezone(guild, OWNER, typed)));
      expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(reply.data.flags).toBe(
        MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      );
      const shown = text(reply.data.components);
      expect(shown).toContain(start);
      expect(shown).toContain(
        "`America/Los_Angeles`, `Europe/Berlin` or `Asia/Kolkata`",
      );
      expect((await settingsOf(guild)).timezone).toBe("Asia/Kolkata");
    },
  );

  it("refuses a non-admin submitting the time zone modal", async () => {
    const guild = "panel-replay-timezone-modal";
    await send(pickRole(guild, OWNER, ROLE));
    const reply = message(
      await send(submitTimezone(guild, STRANGER, "Europe/Berlin")),
    );
    expect(text(reply.data.components)).toBe(ADMIN_ONLY_MESSAGE);
    expect((await settingsOf(guild)).timezone).toBe("America/Los_Angeles");
  });

  it("lets a member with the admin role in", async () => {
    const guild = "panel-role-member";
    await send(pickRole(guild, OWNER, ROLE));
    const reply = message(await send(hikeAdmin(guild, ADMIN, [ROLE])));
    expect(text(reply.data.components)).toContain("hikebot admin");
  });

  describe("refuses a non-admin replaying", () => {
    const replays: [
      string,
      (guild: string) => APIMessageComponentInteraction,
    ][] = [
      [
        ADMIN_PANEL_IDS.settings,
        (g) => click(ADMIN_PANEL_IDS.settings, g, STRANGER),
      ],
      [
        ADMIN_PANEL_IDS.refresh,
        (g) => click(ADMIN_PANEL_IDS.refresh, g, STRANGER),
      ],
      [ADMIN_PANEL_IDS.back, (g) => click(ADMIN_PANEL_IDS.back, g, STRANGER)],
      [
        ADMIN_PANEL_IDS.timezone,
        (g) => click(ADMIN_PANEL_IDS.timezone, g, STRANGER),
      ],
      [
        POLL_CONTROL_IDS.startDateVote,
        (g) => click(POLL_CONTROL_IDS.startDateVote, g, STRANGER),
      ],
      [
        POLL_CONTROL_IDS.createHikeThread(1),
        (g) => click(POLL_CONTROL_IDS.createHikeThread(1), g, STRANGER),
      ],
      [
        POLL_CONTROL_IDS.createHikeEvent(1),
        (g) => click(POLL_CONTROL_IDS.createHikeEvent(1), g, STRANGER),
      ],
      [
        POLL_CONTROL_IDS.announce(1),
        (g) => click(POLL_CONTROL_IDS.announce(1), g, STRANGER),
      ],
      [
        POLL_CONTROL_IDS.postVoteMessage(1),
        (g) => click(POLL_CONTROL_IDS.postVoteMessage(1), g, STRANGER),
      ],
      [
        POLL_CONTROL_IDS.postHikeDay(1),
        (g) => click(POLL_CONTROL_IDS.postHikeDay(1), g, STRANGER),
      ],
      [ADMIN_PANEL_IDS.role, (g) => pickRole(g, STRANGER, ROLE)],
      ...[
        ADMIN_PANEL_IDS.voteChannel,
        ADMIN_PANEL_IDS.announceChannel,
        ADMIN_PANEL_IDS.forumChannel,
      ].map(
        (id): [string, (guild: string) => APIMessageComponentInteraction] => [
          id,
          (g) => pickChannel(id, g, STRANGER, TEXT),
        ],
      ),
    ];

    for (const [id, build] of replays) {
      it(id, async () => {
        const guild = `panel-replay-${id}`;
        await send(pickRole(guild, OWNER, ROLE));
        const reply = message(await send(build(guild)));
        expect(reply.type).toBe(
          InteractionResponseType.ChannelMessageWithSource,
        );
        expect(reply.data.flags).toBe(
          MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        );
        expect(text(reply.data.components)).toBe(ADMIN_ONLY_MESSAGE);
        expect(await settingsOf(guild)).toMatchObject({
          adminRoleId: ROLE,
          voteChannelId: null,
        });
      });
    }
  });
});
