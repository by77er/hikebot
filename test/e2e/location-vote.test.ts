import {
  ChannelType,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import type { FakeMessage } from "./harness/fake-discord";
import {
  allComponents,
  eventually,
  findComponent,
  getComponent,
  Member,
  messageText,
  waitForMessage,
} from "./harness/helpers";
import { subcommand, type Actor } from "./harness/interactions";
import { RoundPlayer } from "./harness/rounds";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

const TITLE = "Where should we hike?";
const CLOSED = "This vote has closed.";
const ID = {
  vote: "hb:admin:vote-channel",
  announce: "hb:admin:announce-channel",
  forum: "hb:admin:forum-channel",
  back: "hb:admin:back",
  start: "hb:location:start",
  initial: "hb:location:initial",
  name: "hb:location:name",
  details: "hb:location:details",
};

/**
 * A guild with an owner, members, and a text, an announcement and a forum
 * channel. `n` keeps each test's ids apart.
 */
function guild(n: number) {
  const pad = String(n).padStart(2, "0");
  const guildId = `2100000000000001${pad}`;
  const id = (prefix: string, i: number) =>
    `${prefix}0000000000002${pad}${String(i).padStart(2, "0")}`;
  const channels = { text: id("3", 1), news: id("3", 2), forum: id("3", 3) };
  const actor = (userId: string): Actor => ({
    guildId,
    channelId: channels.text,
    userId,
  });
  e2e.discord.addGuild({ id: guildId, ownerId: id("4", 0) });
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
    owner: new Member(e2e.client, actor(id("4", 0))),
    members: Array.from(
      { length: 12 },
      (_, i) => new Member(e2e.client, actor(id("4", i + 1))),
    ),
  };
}

/** The message as the fake stores it now. */
function shown(message: { id: string }): FakeMessage {
  const stored = e2e.discord.message(message.id);
  if (!stored) throw new Error(`message ${message.id} is not stored`);
  return stored;
}

/** The custom_ids on a message that start with `prefix`. */
function idsStarting(message: { components: unknown[] }, prefix: string) {
  return allComponents(message.components)
    .map((c) => c.custom_id)
    .filter((id): id is string => typeof id === "string")
    .filter((id) => id.startsWith(prefix));
}

function idStarting(message: { components: unknown[] }, prefix: string) {
  const [found] = idsStarting(message, prefix);
  if (found === undefined) {
    throw new Error(
      `no custom_id starting with ${prefix} in ${JSON.stringify(messageText(message))}`,
    );
  }
  return found;
}

/** Opens the panel as the owner and sets the three channels. */
async function setUpPanel(g: ReturnType<typeof guild>): Promise<FakeMessage> {
  await g.owner.run("hike", [subcommand("admin")]);
  const panel = g.owner.lastReply();
  await g.owner.click(panel, "hb:admin:settings");
  await g.owner.select(panel, ID.vote, [g.channels.text]);
  await g.owner.select(panel, ID.announce, [g.channels.news]);
  await g.owner.select(panel, ID.forum, [g.channels.forum]);
  await g.owner.click(panel, ID.back);
  return panel;
}

/** Starts the location vote from the panel and returns the poll message. */
async function startVote(
  g: ReturnType<typeof guild>,
  panel: FakeMessage,
  initial = "",
): Promise<FakeMessage> {
  const before = e2e.discord.channelMessages(g.channels.text).length;
  const form = await g.owner.click(panel, ID.start);
  const response = await g.owner.submitModal(
    form,
    { [ID.initial]: initial },
    panel,
  );
  expect(response.type).toBe(InteractionResponseType.DeferredMessageUpdate);
  await eventually(() => {
    expect(messageText(shown(panel))).toContain("The location vote is open");
  });
  const poll = e2e.discord.channelMessages(g.channels.text)[before];
  if (!poll) throw new Error("the poll message was not posted");
  expect(messageText(poll)).toContain(TITLE);
  return poll;
}

/** The ids of the options in a vote select, by label. */
function optionValues(select: FakeMessage): Record<string, string> {
  const component = allComponents(select.components).find(
    (c) => c.type === ComponentType.StringSelect,
  );
  const options = (component?.options ?? []) as {
    label: string;
    value: string;
  }[];
  return Object.fromEntries(options.map((o) => [o.label, o.value]));
}

/** Clicks Vote, picks `labels` and returns the select message. */
async function vote(
  member: Member,
  poll: FakeMessage,
  labels: string[],
): Promise<FakeMessage> {
  await member.click(poll, idStarting(shown(poll), "hb:poll:vote:"));
  const select = member.lastReply();
  const values = optionValues(select);
  await member.select(
    select,
    idStarting(select, "hb:poll:choose:"),
    labels.map((label) => values[label] ?? `missing ${label}`),
  );
  return shown(select);
}

async function propose(
  member: Member,
  poll: FakeMessage,
  name: string,
  details = "",
): Promise<string> {
  const form = await member.click(
    poll,
    idStarting(shown(poll), "hb:location:propose:"),
  );
  await member.submitModal(form, { [ID.name]: name, [ID.details]: details });
  return messageText(member.lastReply());
}

/** Closes the open vote from the panel, confirming. */
async function closeVote(owner: Member, panel: FakeMessage): Promise<void> {
  await owner.click(panel, idStarting(shown(panel), "hb:poll:close:"));
  expect(messageText(shown(panel))).toContain("Close the location vote now?");
  const response = await owner.click(
    panel,
    idStarting(shown(panel), "hb:poll:close-confirm:"),
  );
  expect(response.type).toBe(InteractionResponseType.DeferredMessageUpdate);
  await eventually(() => {
    expect(messageText(shown(panel))).toContain("The location vote is closed");
  });
}

function expectEphemeral(member: Member, text: string) {
  const reply = member.lastReply();
  expect(reply.ephemeral).toBe(true);
  expect(reply.flags & MessageFlags.IsComponentsV2).toBe(
    MessageFlags.IsComponentsV2,
  );
  expect(messageText(reply)).toContain(text);
}

function expectNoButtons(message: FakeMessage) {
  expect(
    allComponents(message.components).filter(
      (c) => c.type === ComponentType.Button,
    ),
  ).toEqual([]);
}

function patchesOf(message: { channel_id: string; id: string }) {
  return e2e.discord.requests.filter(
    (r) =>
      r.method === "PATCH" &&
      r.path === `/channels/${message.channel_id}/messages/${message.id}`,
  );
}

describe("the location vote", () => {
  it("names the missing settings and offers no start until setup is complete", async () => {
    const g = guild(1);
    await g.owner.run("hike", [subcommand("admin")]);
    const panel = g.owner.lastReply();
    expect(messageText(panel)).toContain(
      "Setup is not complete: set the voting channel, announcements channel and hike threads channel under Settings.",
    );
    expect(findComponent(panel.components, ID.start)).toBeUndefined();
    await g.owner.click(panel, "hb:admin:settings");
    await g.owner.select(panel, ID.vote, [g.channels.text]);
    await g.owner.click(panel, ID.back);
    expect(messageText(shown(panel))).toContain(
      "set the announcements channel and hike threads channel under Settings.",
    );
    expect(findComponent(shown(panel).components, ID.start)).toBeUndefined();
  });

  it("runs from start through proposals and votes to a clear winner, announced", async () => {
    const g = guild(2);
    const [ana, ben, cy] = g.members as [Member, Member, Member];
    const panel = await setUpPanel(g);
    expect(messageText(panel)).toContain("No hike is being planned.");
    const poll = await startVote(
      g,
      panel,
      " Ridge Trail \n\nridge trail\nLake Loop\n",
    );
    expect(messageText(poll)).toContain("**Ridge Trail** · 0 votes");
    expect(messageText(poll)).toContain("**Lake Loop** · 0 votes");
    expect(messageText(poll)).toContain("No one has voted yet.");
    expect(messageText(poll).match(/Ridge Trail/gi)).toHaveLength(1);

    expect(
      await propose(
        ana,
        poll,
        "Summit Path",
        "https://example.com/summit, 12 km",
      ),
    ).toContain("Added **Summit Path** to the location vote.");

    const anaSelect = await vote(ana, poll, ["Summit Path", "Lake Loop"]);
    expect(messageText(anaSelect)).toContain(
      "Your votes are saved: **Lake Loop**, **Summit Path**.",
    );
    await vote(ben, poll, ["Summit Path"]);
    await vote(cy, poll, ["Summit Path", "Ridge Trail"]);

    await eventually(() => {
      expect(messageText(shown(poll))).toContain("3 members have voted.");
    });
    const text = messageText(shown(poll));
    expect(text).toContain("**Summit Path** · 3 votes");
    expect(text).toContain("https://example.com/summit, 12 km");
    expect(text).toContain(`Proposed by <@${ana.actor.userId}>`);
    expect(text.indexOf("Summit Path")).toBeLessThan(
      text.indexOf("Ridge Trail"),
    );
    expect(shown(poll).flags & MessageFlags.IsComponentsV2).toBeTruthy();

    // A member's select is preselected with their votes; an empty pick clears them.
    await ben.click(poll, idStarting(shown(poll), "hb:poll:vote:"));
    const benSelect = ben.lastReply();
    const select = getComponent(
      benSelect.components,
      idStarting(benSelect, "hb:poll:choose:"),
    );
    expect(select).toMatchObject({ min_values: 0, max_values: 3 });
    expect(
      (select.options as { label: string; default: boolean }[])
        .filter((o) => o.default)
        .map((o) => o.label),
    ).toEqual(["Summit Path"]);

    await g.owner.click(panel, "hb:admin:refresh");
    expect(messageText(shown(panel))).toContain("1. Summit Path: 3 votes");
    expect(messageText(shown(panel))).toContain("3 members have voted.");
    await closeVote(g.owner, panel);

    const final = shown(poll);
    expect(messageText(final)).toContain(`${TITLE} (closed)`);
    expect(messageText(final)).toContain(
      "🏆 **Summit Path** won with 3 votes.",
    );
    expect(messageText(final)).not.toContain("drawn at random");
    expectNoButtons(final);

    const announcement = await waitForMessage(e2e.discord, g.channels.news);
    const announced = messageText(announcement);
    expect(announced).toContain("Hike location decided");
    expect(announced).toContain(
      "**Summit Path** won the location vote with 3 votes.",
    );
    expect(announced).toContain(
      `https://discord.com/channels/${g.guildId}/${poll.channel_id}/${poll.id}`,
    );
    expect(messageText(shown(panel))).toContain(
      "**Location decided:** Summit Path (3 votes).",
    );
    expect(findComponent(shown(panel).components, ID.start)).toBeUndefined();
    for (const request of e2e.discord.requests) {
      if (request.method === "POST" || request.method === "PATCH") {
        expect(request.body).toMatchObject({ allowed_mentions: { parse: [] } });
      }
    }
  });

  it("breaks a tie at random among the tied options and says so", async () => {
    const g = guild(3);
    const [ana, ben] = g.members as [Member, Member];
    const panel = await setUpPanel(g);
    const poll = await startVote(g, panel, "Ridge\nLake\nCanyon");
    await vote(ana, poll, ["Ridge"]);
    await vote(ben, poll, ["Lake"]);
    await closeVote(g.owner, panel);

    const final = messageText(shown(poll));
    const winner = /🏆 \*\*(\w+)\*\* won with 1 vote\./.exec(final)?.[1];
    expect(["Ridge", "Lake"]).toContain(winner);
    expect(final).toContain(
      "2 options tied with 1 vote each; the winner was drawn at random.",
    );
    const announcement = await waitForMessage(e2e.discord, g.channels.news);
    expect(messageText(announcement)).toContain(
      "2 options tied with 1 vote each; the winner was drawn at random.",
    );
    expect(messageText(shown(panel))).toContain("drawn at random from a tie");
  });

  it("holds 25 locations at full length within Discord's limits and refuses a 26th", async () => {
    const g = guild(4);
    const [ana, ben] = g.members as [Member, Member];
    const panel = await setUpPanel(g);
    const label = (i: number) =>
      `${String(i).padStart(2, "0")} ${"x".repeat(77)}`;
    const poll = await startVote(
      g,
      panel,
      Array.from({ length: 24 }, (_, i) => label(i)).join("\n"),
    );
    // Opened at 24 locations, submitted after another member filled the 25th.
    const late = await ben.click(
      poll,
      idStarting(shown(poll), "hb:location:propose:"),
    );
    expect(await propose(ana, poll, label(24), "d".repeat(300))).toContain(
      "Added",
    );
    await ben.submitModal(late, { [ID.name]: "One more" });
    expectEphemeral(ben, "This vote already has 25 locations");
    await ana.click(poll, idStarting(shown(poll), "hb:location:propose:"));
    expectEphemeral(ana, "This vote already has 25 locations");

    await vote(ana, poll, [label(24)]);
    await eventually(() => {
      expect(messageText(shown(poll))).toContain("1 member has voted.");
    });
    expect(messageText(shown(poll))).toContain(`**${label(24)}** · 1 vote`);
    expect(messageText(shown(poll))).toContain("d".repeat(300));
    expect(allComponents(shown(poll).components).length).toBeLessThanOrEqual(
      40,
    );
  });

  it("refuses a duplicate proposal", async () => {
    const g = guild(5);
    const [ana] = g.members as [Member];
    const panel = await setUpPanel(g);
    const poll = await startVote(g, panel, "Ridge Trail");
    expect(await propose(ana, poll, "  ridge   TRAIL ")).toBe(
      "**ridge   TRAIL** is already on the list. Vote for it instead.",
    );
  });

  it("answers votes and proposals after the close with: This vote has closed.", async () => {
    const g = guild(6);
    const [ana, ben] = g.members as [Member, Member];
    const panel = await setUpPanel(g);
    const poll = await startVote(g, panel, "Ridge\nLake");
    await ana.click(poll, idStarting(shown(poll), "hb:poll:vote:"));
    const stale = ana.lastReply();
    const form = await ben.click(
      poll,
      idStarting(shown(poll), "hb:location:propose:"),
    );
    await vote(ben, poll, ["Lake"]);
    await closeVote(g.owner, panel);
    expectNoButtons(shown(poll));

    await ana.select(stale, idStarting(stale, "hb:poll:choose:"), [
      optionValues(stale).Ridge ?? "",
    ]);
    expect(messageText(shown(stale))).toBe(CLOSED);
    await ben.submitModal(form, { [ID.name]: "Canyon" });
    expectEphemeral(ben, CLOSED);
  });

  it("starts no round when the voting channel refuses the poll, and says why", async () => {
    const g = guild(7);
    const panel = await setUpPanel(g);
    e2e.discord.failChannel(g.channels.text, "missing-permissions");
    const form = await g.owner.click(panel, ID.start);
    await g.owner.submitModal(form, { [ID.initial]: "Ridge" }, panel);
    await eventually(() => {
      expect(messageText(shown(panel))).toContain(
        `Could not post the location vote in <#${g.channels.text}>: Discord answered: Missing Permissions (HTTP 403, code 50013).`,
      );
    });
    expect(messageText(shown(panel))).toContain("No round was started");
    expect(messageText(shown(panel))).toContain("No hike is being planned.");
    expect(findComponent(shown(panel).components, ID.start)).toBeDefined();

    e2e.discord.clearChannelFailure(g.channels.text);
    await startVote(g, panel, "Ridge");
  });

  it("keeps the result when the announcements channel refuses it, and says why", async () => {
    const g = guild(8);
    const [ana] = g.members as [Member];
    const panel = await setUpPanel(g);
    const poll = await startVote(g, panel, "Ridge\nLake");
    await vote(ana, poll, ["Lake"]);
    e2e.discord.failChannel(g.channels.news, "missing-permissions");
    await closeVote(g.owner, panel);
    const text = messageText(shown(panel));
    expect(text).toContain(
      `Could not post the announcement in <#${g.channels.news}>: Discord answered: Missing Permissions (HTTP 403, code 50013).`,
    );
    expect(text).toContain("**Location decided:** Lake (1 vote).");
    expect(messageText(shown(poll))).toContain("🏆 **Lake** won with 1 vote.");
    expect(e2e.discord.channelMessages(g.channels.news)).toEqual([]);
  });

  it("refuses to close a vote without locations", async () => {
    const g = guild(9);
    const [ana] = g.members as [Member];
    const panel = await setUpPanel(g);
    const poll = await startVote(g, panel);
    expect(messageText(poll)).toContain("No locations yet.");
    await ana.click(poll, idStarting(shown(poll), "hb:poll:vote:"));
    expectEphemeral(ana, "There are no locations to vote for yet.");
    await g.owner.click(panel, idStarting(shown(panel), "hb:poll:close:"));
    expect(messageText(shown(panel))).toContain(
      "The location vote has no locations yet, so it cannot be closed.",
    );
  });

  it("cancels the round, marks the poll cancelled, and lets a new round start", async () => {
    const g = guild(10);
    const [ana] = g.members as [Member];
    const panel = await setUpPanel(g);
    const poll = await startVote(g, panel, "Ridge");
    await g.owner.click(panel, idStarting(shown(panel), "hb:round:cancel:"));
    expect(messageText(shown(panel))).toContain("Cancel this round?");
    await g.owner.click(panel, ID.back);
    expect(messageText(shown(panel))).toContain("The location vote is open");
    await g.owner.click(panel, idStarting(shown(panel), "hb:round:cancel:"));
    await g.owner.click(
      panel,
      idStarting(shown(panel), "hb:round:cancel-confirm:"),
    );
    await eventually(() => {
      expect(messageText(shown(panel))).toContain("The round is cancelled.");
    });
    expect(messageText(shown(poll))).toContain("This vote was cancelled.");
    expectNoButtons(shown(poll));
    expect(e2e.discord.channelMessages(g.channels.news)).toEqual([]);

    const again = await startVote(g, panel, "Lake");
    expect(again.id).not.toBe(poll.id);
    await vote(ana, again, ["Lake"]);
  });

  it("refuses non-admins, including replayed admin custom_ids", async () => {
    const g = guild(11);
    const [ana] = g.members as [Member];
    const panel = await setUpPanel(g);
    const refusal =
      "The hikebot admin panel is limited to the server owner and members with the admin role.";
    await ana.click(panel, ID.start);
    expectEphemeral(ana, refusal);
    const poll = await startVote(g, panel, "Ridge");
    for (const prefix of ["hb:poll:close:", "hb:round:cancel:"]) {
      await ana.click(panel, idStarting(shown(panel), prefix));
      expectEphemeral(ana, refusal);
    }
    await g.owner.click(panel, idStarting(shown(panel), "hb:poll:close:"));
    await ana.click(panel, idStarting(shown(panel), "hb:poll:close-confirm:"));
    expectEphemeral(ana, refusal);
    expect(
      findComponent(
        shown(poll).components,
        idStarting(shown(poll), "hb:poll:vote:"),
      ),
    ).toBeDefined();
  });

  it("refreshes the poll message a bounded number of times for a burst of votes", async () => {
    const g = guild(12);
    const panel = await setUpPanel(g);
    const poll = await startVote(g, panel, "Ridge\nLake");
    const voters = g.members.slice(0, 8);
    const responses: APIInteractionResponse[] = [];
    for (const member of voters) {
      await member.click(poll, idStarting(shown(poll), "hb:poll:vote:"));
      const select = member.lastReply();
      responses.push(
        await member.select(select, idStarting(select, "hb:poll:choose:"), [
          optionValues(select).Ridge ?? "",
        ]),
      );
    }
    expect(
      responses.every((r) => r.type === InteractionResponseType.UpdateMessage),
    ).toBe(true);
    await eventually(() => {
      expect(messageText(shown(poll))).toContain("8 members have voted.");
    });
    expect(messageText(shown(poll))).toContain("**Ridge** · 8 votes");
    expect(patchesOf(poll).length).toBeGreaterThanOrEqual(1);
    expect(patchesOf(poll).length).toBeLessThanOrEqual(3);
  });
});

describe("suggesting a past location again", () => {
  it("offers earlier rounds' locations, rests the last two hikes, and offers them again after two more", async () => {
    const g = play.guild(20);
    const [ana, ben, cy] = g.members as [Member, Member, Member];
    const panel = await play.setUpPanel(g);

    // Round 1: Alpine Lake, Bear Creek and a proposal; Alpine Lake is the hike.
    const first = await play.startLocationVote(
      g,
      panel,
      "Alpine Lake\nBear Creek",
    );
    expect(
      await propose(
        ana,
        first,
        "Cedar Falls",
        "https://example.com/cedar, 9 km",
      ),
    ).toContain("Added **Cedar Falls** to the location vote.");
    await play.finishRound(
      g,
      panel,
      first,
      "Alpine Lake",
      "2030-06-08\n2030-06-15",
      "Sat, 8 Jun 2030",
    );

    // The admin cannot put Alpine Lake on the next vote.
    const form = await g.owner.click(panel, ID.start);
    await g.owner.submitModal(
      form,
      { [ID.initial]: "Dune Ridge\nalpine  LAKE" },
      panel,
    );
    expectEphemeral(
      g.owner,
      "Nothing was started. Remove this location and try again:\n- **Alpine Lake** was the hike on Sat, 8 Jun 2030. It can be suggested again after 2 more hikes.",
    );

    // Round 2: Propose a location offers Bear Creek and Cedar Falls.
    const second = await play.startLocationVote(g, panel, "");
    await cy.click(second, idStarting(shown(second), "hb:location:propose:"));
    const stale = cy.lastReply();
    await ben.click(second, idStarting(shown(second), "hb:location:propose:"));
    const offer = ben.lastReply();
    expect(offer.ephemeral).toBe(true);
    expect(offer.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(Object.keys(optionValues(offer))).toEqual([
      "Cedar Falls",
      "Bear Creek",
    ]);
    expect(messageText(offer)).toContain(
      "Resting: **Alpine Lake** (2 more hikes)",
    );
    const again = idStarting(offer, "hb:location:again:");
    expect(again).toMatch(/^hb:location:again:\d+$/);
    await ben.select(offer, again, [optionValues(offer)["Cedar Falls"] ?? ""]);
    expect(messageText(shown(offer))).toContain(
      "Added **Cedar Falls** to the location vote.",
    );
    expect(Object.keys(optionValues(shown(offer)))).toEqual(["Bear Creek"]);
    await eventually(() => {
      expect(messageText(shown(second))).toContain("**Cedar Falls** · 0 votes");
    });
    expect(messageText(shown(second))).toContain(
      "https://example.com/cedar, 9 km",
    );
    expect(messageText(shown(second))).toContain(
      `Proposed by <@${ben.actor.userId}>`,
    );

    // A select opened before Ben's pick: Cedar Falls is on the list now.
    await cy.select(stale, again, [optionValues(stale)["Cedar Falls"] ?? ""]);
    expect(messageText(shown(stale))).toContain(
      "**Cedar Falls** is already on the list. Vote for it instead.",
    );

    // Typing the resting location in the modal is refused.
    const typed = await cy.click(
      shown(stale),
      idStarting(shown(stale), "hb:location:new:"),
    );
    await cy.submitModal(typed, { [ID.name]: "Alpine Lake" });
    expectEphemeral(
      cy,
      "**Alpine Lake** was the hike on Sat, 8 Jun 2030. It can be suggested again after 2 more hikes.",
    );
    await play.finishRound(
      g,
      panel,
      second,
      "Cedar Falls",
      "2030-07-06\n2030-07-07",
      "Sat, 6 Jul 2030",
    );

    // Round 3: Alpine Lake rests one more hike.
    const third = await play.startLocationVote(g, panel, "Bear Creek");
    // Nothing to suggest again: the button opens the modal directly.
    const direct = await ana.click(
      third,
      idStarting(shown(third), "hb:location:propose:"),
    );
    expect(direct.type).toBe(InteractionResponseType.Modal);
    await play.finishRound(
      g,
      panel,
      third,
      "Bear Creek",
      "2030-08-03\n2030-08-04",
      "Sat, 3 Aug 2030",
    );

    // Round 4: two hikes later, Alpine Lake is offered again.
    const fourth = await play.startLocationVote(g, panel, "");
    await ana.click(fourth, idStarting(shown(fourth), "hb:location:propose:"));
    const later = ana.lastReply();
    expect(Object.keys(optionValues(later))).toEqual(["Alpine Lake"]);
    expect(messageText(later)).toContain(
      "Resting: **Bear Creek** (2 more hikes), **Cedar Falls** (1 more hike)",
    );
  });
});
