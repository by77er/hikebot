import { afterEach, describe, expect, it, vi } from "vitest";
import type { GuildConfig } from "../../src/guild/config";
import type { PollStore } from "../../src/polls/store";
import { completeRound } from "../polls/helpers";
import { OWNER, viewAfter } from "./view-after";

/** Tuesday 1 January 2030, 04:00 in Los Angeles. */
const NOW = Date.UTC(2030, 0, 1, 12);
/** Wednesday 2 January 2030, 09:00 in Los Angeles: the next cadence instant. */
const NEXT_WEDNESDAY = Date.UTC(2030, 0, 2, 17);
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The schedule's section at NOW, the schedule on (Wednesdays 09:00) unless `off`. */
async function scheduleAfter(
  seed: (store: PollStore) => void = () => undefined,
  off = false,
) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const { view } = await viewAfter(803, (store, config: GuildConfig) => {
    if (!off) config.setCadence({ enabled: true, onSince: NOW - 30 * DAY });
    seed(store);
    vi.setSystemTime(NOW);
  });
  return view.schedule;
}

/** Starts a location vote at `at` with one option, voted for. */
function locationVoteAt(store: PollStore, at: number): void {
  vi.setSystemTime(at);
  const round = store.startRound(OWNER, [{ label: "Lake", proposedBy: OWNER }]);
  const poll = round.locationPoll;
  if (!poll) throw new Error("no location poll");
  store.setVotes(poll.id, OWNER, [poll.options[0]?.id ?? 0]);
}

describe("the web view's schedule", () => {
  it("is null while the schedule is off", async () => {
    expect(await scheduleAfter(undefined, true)).toBeNull();
  });

  it("opens a location vote at the next weekday and time, in the server's time zone", async () => {
    expect(await scheduleAfter()).toEqual({
      weekday: "Wednesday",
      time: "09:00",
      timeZone: "America/Los_Angeles",
      dateVoteDays: 2,
      next: {
        kind: "start-location-vote",
        at: NEXT_WEDNESDAY,
        when: "Wednesday 09:00",
      },
      waiting: null,
    });
  });

  it("closes a location vote open for a week at the next instant", async () => {
    const schedule = await scheduleAfter((store) => {
      locationVoteAt(store, NOW - 8 * DAY);
    });
    expect(schedule?.next).toEqual({
      kind: "close-location-vote",
      at: NEXT_WEDNESDAY,
      when: "Wednesday 09:00",
    });
  });

  it("names the date of an action more than a week away", async () => {
    const schedule = await scheduleAfter((store) => {
      locationVoteAt(store, NOW);
    });
    expect(schedule?.next).toEqual({
      kind: "close-location-vote",
      at: NEXT_WEDNESDAY + 7 * DAY,
      when: "Wednesday 9 Jan 09:00",
    });
  });

  it("opens the next location vote after a planned hike within its weeks", async () => {
    const schedule = await scheduleAfter((store) => {
      completeRound(store, "Ridge", "2030-01-12 11:00");
    });
    expect(schedule?.next).toEqual({
      kind: "start-location-vote",
      at: NEXT_WEDNESDAY + 14 * DAY,
      when: "Wednesday 16 Jan 09:00",
    });
  });

  it("waits for a planned hike further ahead than it looks", async () => {
    const schedule = await scheduleAfter((store) => {
      completeRound(store, "Ridge", "2030-06-15 11:00");
    });
    expect(schedule).toMatchObject({ next: null, waiting: "planned_hike" });
  });

  it("waits for an admin to close a date vote started before it was turned on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { view } = await viewAfter(803, (store, config) => {
      vi.setSystemTime(NOW - 3 * DAY);
      const round = store.startRound(OWNER, [
        { label: "Lake", proposedBy: OWNER },
      ]);
      const poll = round.locationPoll;
      if (!poll) throw new Error("no location poll");
      store.setVotes(poll.id, OWNER, [poll.options[0]?.id ?? 0]);
      store.closePoll(poll.id, OWNER);
      store.startDatePoll(round.id, OWNER, ["2030-01-12", "2030-01-13"]);
      vi.setSystemTime(NOW);
      config.setCadence({ enabled: true, onSince: NOW });
    });
    expect(view.schedule).toMatchObject({
      next: null,
      waiting: "manual_date_vote",
    });
  });
});
