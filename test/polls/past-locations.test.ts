import { describe, expect, it } from "vitest";
import { isPollError } from "../../src/polls/errors";
import {
  COOLDOWN_HIKES,
  cooldownMessage,
  type NewOption,
  type PollStore,
} from "../../src/polls/store";
import { count, expectCode, locations, withStore } from "./helpers";

/**
 * Plays a round to `complete`: a location poll with `options`, won by
 * `winner`, then a date poll won by `date`.
 */
function completeRound(
  store: PollStore,
  options: readonly NewOption[],
  winner: string,
  date: string,
): number {
  const round = store.startRound("u-admin", options);
  const poll = round.locationPoll;
  if (!poll) throw new Error("no location poll");
  const won = poll.options.find((o) => o.label === winner);
  store.setVotes(poll.id, "u-voter", [won?.id ?? 0]);
  store.closePoll(poll.id, "u-admin");
  const datePoll = store.startDatePoll(round.id, "u-admin", [
    date,
    "2040-01-01",
  ]);
  const day = datePoll.options.find((o) => o.dateValue === date);
  store.setVotes(datePoll.id, "u-voter", [day?.id ?? 0]);
  store.closePoll(datePoll.id, "u-admin");
  return round.id;
}

/** The message `fn` is refused with, as `location_on_cooldown`. */
function cooldownRefusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (isPollError(error, "location_on_cooldown")) return error.message;
    throw error;
  }
  throw new Error("expected location_on_cooldown");
}

describe("listPastLocations", () => {
  it("merges every round's locations by label_key, newest label and details first", async () => {
    const past = await withStore((store) => {
      completeRound(
        store,
        [
          { label: "Ridge", details: "old notes", proposedBy: "u-admin" },
          { label: "Lake", details: "lake v1", proposedBy: "u-admin" },
        ],
        "Ridge",
        "2026-12-05",
      );
      const first = store.getLastRound()?.locationPoll?.id ?? 0;
      store.cancelRound(store.startRound("u-admin").id, "u-admin");
      const round = store.startRound("u-admin");
      const pollId = round.locationPoll?.id ?? 0;
      store.addOption(pollId, {
        label: "  LAKE ",
        details: "lake v2",
        proposedBy: "u2",
      });
      return {
        first,
        pollId,
        viewer: store.listPastLocations("u1", pollId),
        admin: store.listPastLocations("u-admin", first),
      };
    });
    expect(past.viewer).toEqual([
      {
        optionId: expect.any(Number) as number,
        label: "LAKE",
        key: "lake",
        details: "lake v2",
        proposedByViewer: false,
        lastProposedAt: expect.any(Number) as number,
        timesHiked: 0,
        cooldownHikesLeft: 0,
        onPoll: true,
      },
      {
        optionId: expect.any(Number) as number,
        label: "Ridge",
        key: "ridge",
        details: "old notes",
        proposedByViewer: false,
        lastProposedAt: expect.any(Number) as number,
        timesHiked: 1,
        cooldownHikesLeft: COOLDOWN_HIKES,
        onPoll: false,
      },
    ]);
    const [lake, ridge] = past.viewer;
    expect(lake?.lastProposedAt).toBeGreaterThan(ridge?.lastProposedAt ?? 0);
    // The admin proposed both in round 1; seen from that round's poll.
    expect(
      past.admin.map((p) => [p.label, p.proposedByViewer, p.onPoll]),
    ).toEqual([
      ["LAKE", true, true],
      ["Ridge", true, true],
    ]);
  });

  it("lists the viewer's own suggestions first, each group most recent first", async () => {
    const labels = await withStore((store) => {
      const round = store.startRound("u-admin");
      const pollId = round.locationPoll?.id ?? 0;
      for (const [label, by] of [
        ["Mine old", "u1"],
        ["Theirs old", "u2"],
        ["Mine new", "u1"],
        ["Theirs new", "u3"],
      ] as const) {
        store.addOption(pollId, { label, proposedBy: by });
      }
      return store
        .listPastLocations("u1", pollId)
        .map((p) => [p.label, p.proposedByViewer]);
    });
    expect(labels).toEqual([
      ["Mine new", true],
      ["Mine old", true],
      ["Theirs new", false],
      ["Theirs old", false],
    ]);
  });

  it("is empty before any location was proposed and ignores date options", async () => {
    const result = await withStore((store) => {
      const before = store.listPastLocations("u1", 1);
      completeRound(store, locations("Ridge"), "Ridge", "2030-06-08");
      return {
        before,
        after: store.listPastLocations("u1", 1).map((p) => p.label),
      };
    });
    expect(result.before).toEqual([]);
    expect(result.after).toEqual(["Ridge"]);
  });
});

describe("the location cooldown", () => {
  it("rests the hike of the last two complete rounds, ignoring a cancelled one, over four rounds", async () => {
    await withStore((store, storage) => {
      // Round 1 completes with Eagle Peak.
      completeRound(
        store,
        locations("Eagle Peak", "Lake"),
        "Eagle Peak",
        "2026-12-05",
      );
      expect(store.restingLocations()).toEqual([
        {
          label: "Eagle Peak",
          key: "eagle peak",
          hikedOn: "Sat, 5 Dec 2026",
          hikesLeft: 2,
        },
      ]);

      // Round 2 decides Lake, then is cancelled: Lake does not rest.
      const two = store.startRound("u-admin", locations("Lake"));
      const twoPoll = two.locationPoll?.id ?? 0;
      expect(
        cooldownRefusal(() =>
          store.addOption(twoPoll, {
            label: " eagle   PEAK ",
            proposedBy: "u1",
          }),
        ),
      ).toBe(
        "**Eagle Peak** was the hike on Sat, 5 Dec 2026. It can be suggested again after 2 more hikes.",
      );
      store.closePoll(twoPoll, "u-admin");
      store.cancelRound(two.id, "u-admin");
      expect(store.restingLocations().map((r) => r.key)).toEqual([
        "eagle peak",
      ]);

      // Round 3 cannot start with Eagle Peak; it completes with Lake.
      const rounds = count(storage, "rounds");
      expectCode(
        () => store.startRound("u-admin", locations("Ridge", "EAGLE PEAK")),
        "location_on_cooldown",
      );
      expect(count(storage, "rounds")).toBe(rounds);
      completeRound(
        store,
        locations("Lake", "Ridge"),
        "Lake",
        "2027-01-09 08:30",
      );
      expect(
        store.restingLocations().map((r) => [r.label, r.hikesLeft, r.hikedOn]),
      ).toEqual([
        ["Lake", 2, "Sat, 9 Jan 2027"],
        ["Eagle Peak", 1, "Sat, 5 Dec 2026"],
      ]);

      // Round 4: Eagle Peak has one more hike to rest.
      const four = store.startRound("u-admin", locations("Ridge"));
      const fourPoll = four.locationPoll?.id ?? 0;
      expect(
        cooldownRefusal(() =>
          store.addOption(fourPoll, { label: "Eagle Peak", proposedBy: "u1" }),
        ),
      ).toBe(
        "**Eagle Peak** was the hike on Sat, 5 Dec 2026. It can be suggested again after 1 more hike.",
      );
      store.cancelRound(four.id, "u-admin");
      completeRound(store, locations("Ridge"), "Ridge", "2027-02-06");

      // Two rounds completed since: Eagle Peak is accepted again.
      expect(store.restingLocations().map((r) => r.label)).toEqual([
        "Ridge",
        "Lake",
      ]);
      const five = store.startRound("u-admin", locations("Eagle Peak"));
      expect(five.locationPoll?.options.map((o) => o.label)).toEqual([
        "Eagle Peak",
      ]);
      expect(
        store
          .listPastLocations("u1", five.locationPoll?.id ?? 0)
          .map((p) => [p.label, p.cooldownHikesLeft, p.timesHiked]),
      ).toEqual([
        ["Eagle Peak", 0, 1],
        ["Ridge", 2, 1],
        ["Lake", 1, 1],
      ]);
    });
  });

  it("does not apply to date polls", async () => {
    await withStore((store) => {
      completeRound(store, locations("Ridge"), "Ridge", "2030-06-08");
      const round = store.startRound("u-admin", locations("Lake"));
      store.closePoll(round.locationPoll?.id ?? 0, "u-admin");
      const datePoll = store.startDatePoll(round.id, "u-admin", [
        "2030-06-08",
        "2030-06-15",
      ]);
      expect(datePoll.options).toHaveLength(2);
    });
  });

  it("says 1 more hike or N more hikes, and leaves out a missing date", () => {
    const resting = { label: "Ridge", key: "ridge", hikedOn: null };
    expect(cooldownMessage({ ...resting, hikesLeft: 1 })).toBe(
      "**Ridge** was the hike. It can be suggested again after 1 more hike.",
    );
    expect(
      cooldownMessage({ ...resting, hikedOn: "Sun, 6 Dec 2026", hikesLeft: 2 }),
    ).toBe(
      "**Ridge** was the hike on Sun, 6 Dec 2026. It can be suggested again after 2 more hikes.",
    );
  });
});

describe("getOption", () => {
  it("reads an option of any poll, or null", async () => {
    const result = await withStore((store) => {
      const round = store.startRound("u-admin", [
        { label: "Ridge", details: "steep", proposedBy: "u1" },
      ]);
      const id = round.locationPoll?.options[0]?.id ?? 0;
      return { found: store.getOption(id), missing: store.getOption(id + 99) };
    });
    expect(result.found).toMatchObject({
      label: "Ridge",
      details: "steep",
      proposedBy: "u1",
    });
    expect(result.missing).toBeNull();
  });
});
