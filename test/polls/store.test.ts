import { describe, expect, it } from "vitest";
import { addDays } from "../../src/polls/dates";
import { isPollError } from "../../src/polls/errors";
import {
  COOLDOWN_HIKES,
  MAX_OPTIONS,
  cooldownMessage,
  type PollStore,
} from "../../src/polls/store";
import {
  clock,
  completeRound,
  count,
  expectCode,
  locations,
  playRound,
  sequence,
  withStore,
} from "./helpers";

/** A round whose location poll is closed with `Ridge` as the winner. */
function decidedRound(store: PollStore) {
  const round = store.startRound("u-admin", locations("Ridge", "Lake"));
  const poll = round.locationPoll;
  if (!poll) throw new Error("no location poll");
  store.setVotes(poll.id, "u1", [poll.options[0]?.id ?? 0]);
  store.closePoll(poll.id, "u-admin");
  return round;
}

function dates(n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `2027-01-${String(i + 1).padStart(2, "0")}`,
  );
}

describe("startRound", () => {
  it("creates a round with an open location poll and its options", async () => {
    const round = await withStore((store) =>
      store.startRound("u-admin", [
        { label: "  Ridge  trail ", details: " Steep ", proposedBy: "u1" },
        { label: "Lake loop", proposedBy: "u2" },
      ]),
    );
    expect(round).toMatchObject({
      status: "location_voting",
      startedBy: "u-admin",
      startedAt: 1_800_000_000_000,
      threadId: null,
      locationOptionId: null,
      dateOptionId: null,
      datePoll: null,
    });
    expect(round.locationPoll).toMatchObject({
      roundId: round.id,
      kind: "location",
      status: "open",
      openedBy: "u-admin",
      channelId: null,
      messageId: null,
      winnerOptionId: null,
      voterCount: 0,
      viewerVotes: [],
    });
    expect(
      round.locationPoll?.options.map((o) => [
        o.label,
        o.details,
        o.proposedBy,
        o.votes,
        o.dateValue,
      ]),
    ).toEqual([
      ["Ridge  trail", "Steep", "u1", 0, null],
      ["Lake loop", null, "u2", 0, null],
    ]);
  });

  it("accepts no initial options", async () => {
    const round = await withStore((store) => store.startRound("u-admin"));
    expect(round.locationPoll?.options).toEqual([]);
  });

  it("fails with round_active while a round is active", async () => {
    await withStore((store, storage) => {
      store.startRound("u-admin");
      expectCode(() => store.startRound("u-admin"), "round_active");
      expect(count(storage, "rounds")).toBe(1);
    });
  });

  it("rejects duplicate or invalid initial options and writes nothing", async () => {
    await withStore((store, storage) => {
      expectCode(
        () => store.startRound("u-admin", locations("Ridge", "ridge")),
        "duplicate_option",
      );
      expectCode(
        () => store.startRound("u-admin", locations("Ridge", " ")),
        "invalid_label",
      );
      expectCode(
        () =>
          store.startRound(
            "u-admin",
            locations(...Array.from({ length: 26 }, (_, i) => `L${String(i)}`)),
          ),
        "too_many_options",
      );
      expect(count(storage, "rounds")).toBe(0);
      expect(count(storage, "polls")).toBe(0);
      expect(count(storage, "poll_options")).toBe(0);
    });
  });
});

describe("addOption", () => {
  it("adds a trimmed option with details", async () => {
    await withStore((store) => {
      const poll = store.startRound("u-admin").locationPoll;
      const option = store.addOption(poll?.id ?? 0, {
        label: "  Summit ",
        details: "Bring water",
        proposedBy: "u3",
      });
      expect(option).toMatchObject({
        label: "Summit",
        details: "Bring water",
        proposedBy: "u3",
        votes: 0,
        createdAt: 1_800_000_001_000,
      });
      expect(store.getPoll(poll?.id ?? 0)?.options).toEqual([option]);
    });
  });

  it("enforces label and details lengths", async () => {
    await withStore((store) => {
      const pollId = store.startRound("u-admin").locationPoll?.id ?? 0;
      const add = (label: string, details?: string) =>
        store.addOption(pollId, { label, details, proposedBy: "u1" });
      expectCode(() => add(""), "invalid_label");
      expectCode(() => add("   "), "invalid_label");
      expectCode(() => add("x".repeat(81)), "invalid_label");
      expectCode(() => add("ok", "d".repeat(301)), "invalid_details");
      expect(add(` ${"x".repeat(80)} `).label).toHaveLength(80);
      expect(add("ok", "d".repeat(300)).details).toHaveLength(300);
      expect(add("blank details", "   ").details).toBeNull();
    });
  });

  it("treats labels differing only in case and whitespace as duplicates", async () => {
    await withStore((store) => {
      const pollId =
        store.startRound("u-admin", locations("Ridge Trail")).locationPoll
          ?.id ?? 0;
      for (const label of ["ridge trail", "  RIDGE   TRAIL ", "Ridge\tTrail"]) {
        expectCode(
          () => store.addOption(pollId, { label, proposedBy: "u1" }),
          "duplicate_option",
        );
      }
      store.addOption(pollId, { label: "Ridge Trails", proposedBy: "u1" });
      expect(store.getPoll(pollId)?.options).toHaveLength(2);
    });
  });

  it(`caps a poll at ${String(MAX_OPTIONS)} options`, async () => {
    await withStore((store) => {
      const pollId = store.startRound("u-admin").locationPoll?.id ?? 0;
      for (let i = 0; i < MAX_OPTIONS; i++) {
        store.addOption(pollId, { label: `L${String(i)}`, proposedBy: "u1" });
      }
      expectCode(
        () => store.addOption(pollId, { label: "one more", proposedBy: "u1" }),
        "too_many_options",
      );
      expect(store.getPoll(pollId)?.options).toHaveLength(MAX_OPTIONS);
    });
  });

  it("fails on a closed poll and an unknown poll", async () => {
    await withStore((store) => {
      const round = decidedRound(store);
      expectCode(
        () =>
          store.addOption(round.locationPoll?.id ?? 0, {
            label: "Late",
            proposedBy: "u1",
          }),
        "poll_closed",
      );
      expectCode(
        () => store.addOption(999, { label: "x", proposedBy: "u1" }),
        "poll_not_found",
      );
    });
  });

  it("parses the label on a date poll", async () => {
    await withStore((store) => {
      const round = decidedRound(store);
      const poll = store.startDatePoll(round.id, "u-admin", dates(2));
      const option = store.addOption(poll.id, {
        label: "2026-12-05 09:00",
        proposedBy: "u-admin",
      });
      expect(option).toMatchObject({
        label: "Sat, 5 Dec 2026 · 09:00",
        dateValue: "2026-12-05 09:00",
      });
      expectCode(
        () =>
          store.addOption(poll.id, {
            label: "2026-12-05 09:00",
            proposedBy: "u-admin",
          }),
        "duplicate_option",
      );
      expectCode(
        () => store.addOption(poll.id, { label: "soon", proposedBy: "u1" }),
        "invalid_date",
      );
    });
  });
});

describe("setVotes and read models", () => {
  it("replaces, counts and clears a user's votes", async () => {
    await withStore((store) => {
      const poll = store.startRound(
        "u-admin",
        locations("A", "B", "C"),
      ).locationPoll;
      const [a, b, c] = (poll?.options ?? []).map((o) => o.id) as [
        number,
        number,
        number,
      ];
      const pollId = poll?.id ?? 0;

      store.setVotes(pollId, "u1", [a, b]);
      store.setVotes(pollId, "u2", [b, b]);
      let view = store.getPoll(pollId, "u1");
      expect(view?.options.map((o) => o.votes)).toEqual([1, 2, 0]);
      expect(view?.voterCount).toBe(2);
      expect(view?.viewerVotes).toEqual([a, b]);

      view = store.setVotes(pollId, "u1", [c]);
      expect(view.options.map((o) => o.votes)).toEqual([0, 1, 1]);
      expect(view.viewerVotes).toEqual([c]);
      expect(store.getPoll(pollId, "u2")?.viewerVotes).toEqual([b]);

      view = store.setVotes(pollId, "u1", []);
      expect(view.options.map((o) => o.votes)).toEqual([0, 1, 0]);
      expect(view.voterCount).toBe(1);
      expect(view.viewerVotes).toEqual([]);
      expect(store.getPoll(pollId)?.viewerVotes).toEqual([]);
    });
  });

  it("rejects options from another poll and leaves votes unchanged", async () => {
    await withStore((store) => {
      const round = decidedRound(store);
      const datePoll = store.startDatePoll(round.id, "u-admin", dates(2));
      const [first] = datePoll.options;
      store.setVotes(datePoll.id, "u1", [first?.id ?? 0]);
      const locationOption = round.locationPoll?.options[1]?.id ?? 0;
      expectCode(
        () => store.setVotes(datePoll.id, "u1", [locationOption]),
        "unknown_option",
      );
      expectCode(
        () => store.setVotes(datePoll.id, "u1", [first?.id ?? 0, 999]),
        "unknown_option",
      );
      expect(store.getPoll(datePoll.id, "u1")?.viewerVotes).toEqual([
        first?.id,
      ]);
    });
  });

  it("fails on a closed poll and an unknown poll", async () => {
    await withStore((store) => {
      const round = decidedRound(store);
      expectCode(
        () => store.setVotes(round.locationPoll?.id ?? 0, "u1", []),
        "poll_closed",
      );
      expectCode(() => store.setVotes(999, "u1", []), "poll_not_found");
    });
  });

  it("reads the active and last rounds", async () => {
    await withStore((store) => {
      expect(store.getActiveRound()).toBeNull();
      expect(store.getLastRound()).toBeNull();
      expect(store.getPoll(1)).toBeNull();
      expect(store.getRound(1)).toBeNull();

      const first = store.startRound("u-admin", locations("A"));
      const pollId = first.locationPoll?.id ?? 0;
      const optionId = first.locationPoll?.options[0]?.id ?? 0;
      store.setVotes(pollId, "u1", [optionId]);
      const active = store.getActiveRound("u1");
      expect(active?.id).toBe(first.id);
      expect(active?.locationPoll?.viewerVotes).toEqual([optionId]);
      expect(active?.locationPoll?.voterCount).toBe(1);

      store.cancelRound(first.id, "u-admin");
      expect(store.getActiveRound()).toBeNull();
      expect(store.getLastRound()?.status).toBe("cancelled");

      const second = store.startRound("u-admin");
      expect(store.getLastRound()?.id).toBe(second.id);
      expect(store.getRound(first.id)?.status).toBe("cancelled");
    });
  });
});

describe("closePoll", () => {
  it("picks the top option and moves the round to location_decided", async () => {
    await withStore((store) => {
      const poll = store.startRound(
        "u-admin",
        locations("A", "B", "C"),
      ).locationPoll;
      const [a, b] = (poll?.options ?? []).map((o) => o.id);
      const pollId = poll?.id ?? 0;
      store.setVotes(pollId, "u1", [a ?? 0, b ?? 0]);
      store.setVotes(pollId, "u2", [b ?? 0]);
      const closed = store.closePoll(pollId, "u-admin");
      expect(closed).toMatchObject({
        status: "closed",
        winnerOptionId: b,
        tieBroken: false,
        tiedOptionIds: [],
        closedBy: "u-admin",
      });
      expect(closed.closedAt).toBeGreaterThan(closed.openedAt);
      expect(store.getActiveRound()).toMatchObject({
        status: "location_decided",
        locationOptionId: b,
      });
    });
  });

  it("breaks a tie with the injected random source", async () => {
    for (const [value, index] of [
      [0, 0],
      [1, 2],
      [2, 3],
      [3, 0],
    ] as const) {
      await withStore(
        (store) => {
          const poll = store.startRound(
            "u-admin",
            locations("A", "B", "C", "D"),
          ).locationPoll;
          const ids = (poll?.options ?? []).map((o) => o.id);
          const pollId = poll?.id ?? 0;
          const at = (i: number) => ids[i] ?? 0;
          store.setVotes(pollId, "u1", [at(0), at(2), at(3)]);
          store.setVotes(pollId, "u2", [at(0), at(1), at(2), at(3)]);
          store.setVotes(pollId, "u3", [at(1)]);
          store.setVotes(pollId, "u4", [at(0), at(2), at(3)]);
          const closed = store.closePoll(pollId, "u-admin");
          expect(closed.winnerOptionId).toBe(at(index));
          expect(closed.tieBroken).toBe(true);
          expect(closed.tiedOptionIds).toEqual([at(0), at(2), at(3)]);
          expect(store.getPoll(pollId)?.tiedOptionIds).toEqual([
            at(0),
            at(2),
            at(3),
          ]);
        },
        { random: sequence(value) },
      );
    }
  });

  it("draws among all options when nobody voted", async () => {
    await withStore(
      (store) => {
        const poll = store.startRound(
          "u-admin",
          locations("A", "B", "C"),
        ).locationPoll;
        const ids = (poll?.options ?? []).map((o) => o.id);
        const closed = store.closePoll(poll?.id ?? 0, "u-admin");
        expect(closed.winnerOptionId).toBe(ids[1]);
        expect(closed.tieBroken).toBe(true);
        expect(closed.tiedOptionIds).toEqual(ids);
      },
      { random: sequence(1) },
    );
  });

  it("fails on a poll without options, a closed poll and an unknown poll", async () => {
    await withStore((store, storage) => {
      const round = store.startRound("u-admin");
      const pollId = round.locationPoll?.id ?? 0;
      expectCode(() => store.closePoll(pollId, "u-admin"), "no_options");
      expect(store.getPoll(pollId)?.status).toBe("open");
      store.addOption(pollId, { label: "A", proposedBy: "u1" });
      store.closePoll(pollId, "u-admin");
      expectCode(() => store.closePoll(pollId, "u-admin"), "poll_closed");
      expectCode(() => store.closePoll(999, "u-admin"), "poll_not_found");
      expect(count(storage, "rounds")).toBe(1);
    });
  });
});

describe("startDatePoll", () => {
  it("opens a date poll in date order and moves the round to date_voting", async () => {
    await withStore((store) => {
      const round = decidedRound(store);
      const poll = store.startDatePoll(round.id, "u-admin", [
        "2026-12-12",
        "2026-12-05 09:00",
        "2026-12-05",
      ]);
      expect(poll).toMatchObject({
        roundId: round.id,
        kind: "date",
        status: "open",
        openedBy: "u-admin",
      });
      expect(poll.options.map((o) => [o.dateValue, o.label])).toEqual([
        ["2026-12-05 09:00", "Sat, 5 Dec 2026 · 09:00"],
        ["2026-12-05 11:00", "Sat, 5 Dec 2026 · 11:00"],
        ["2026-12-12 11:00", "Sat, 12 Dec 2026 · 11:00"],
      ]);
      expect(store.getActiveRound()).toMatchObject({
        status: "date_voting",
        datePoll: { id: poll.id },
      });
    });
  });

  it("requires 2 to 25 distinct valid dates", async () => {
    await withStore((store, storage) => {
      const round = decidedRound(store);
      const start = (lines: string[]) =>
        store.startDatePoll(round.id, "u-admin", lines);
      expectCode(() => start(dates(1)), "too_few_options");
      expectCode(() => start([]), "too_few_options");
      expectCode(() => start([...dates(25), "2027-02-01"]), "too_many_options");
      expectCode(
        () => start(["2027-01-01", " 2027-01-01 "]),
        "duplicate_option",
      );
      // A date without a time is the same option as that date at 11:00.
      expectCode(
        () => start(["2027-01-01", "2027-01-01 11:00"]),
        "duplicate_option",
      );
      expectCode(() => start(["2027-01-01", "2027-02-30"]), "invalid_date");
      expect(count(storage, "polls")).toBe(1);
      expect(start(dates(25)).options).toHaveLength(25);
    });
  });

  it("works only from location_decided", async () => {
    await withStore((store) => {
      const round = store.startRound("u-admin", locations("A"));
      expectCode(
        () => store.startDatePoll(round.id, "u-admin", dates(2)),
        "invalid_state",
      );
      store.closePoll(round.locationPoll?.id ?? 0, "u-admin");
      store.startDatePoll(round.id, "u-admin", dates(2));
      expectCode(
        () => store.startDatePoll(round.id, "u-admin", dates(2)),
        "invalid_state",
      );
      expectCode(
        () => store.startDatePoll(999, "u-admin", dates(2)),
        "round_not_found",
      );
    });
  });
});

describe("proposeDate", () => {
  /** 05:00 UTC on Thu 19 Nov 2026: still Wed 18 Nov in Los Angeles. */
  const NOW = Date.UTC(2026, 10, 19, 5);
  const LA = "America/Los_Angeles";
  /** 18:00 on Thu 19 Nov 2026 in Auckland. */
  const AUCKLAND = "Pacific/Auckland";

  function openDatePoll(store: PollStore) {
    const round = decidedRound(store);
    return store.startDatePoll(round.id, "u-admin", [
      "2026-11-28",
      "2026-12-12",
    ]);
  }

  it.each([
    [LA, "2026-11-17", "2026-11-18", "2026-12-19", "2026-12-20"],
    [AUCKLAND, "2026-11-18", "2026-11-19", "2026-12-20", "2026-12-21"],
  ])(
    "in %s refuses %s, accepts today %s and %s (31 days ahead), and refuses %s",
    async (zone, yesterday, today, last, after) => {
      await withStore(
        (store) => {
          const poll = openDatePoll(store);
          const propose = (line: string) =>
            store.proposeDate(poll.id, "u-member", line, zone);
          expectCode(() => propose(yesterday), "date_in_past");
          expectCode(() => propose(after), "date_too_far");
          expect(store.getPoll(poll.id)?.options.length).toBe(2);
          expect(propose(today)).toMatchObject({
            dateValue: `${today} 11:00`,
            proposedBy: "u-member",
            votes: 0,
          });
          expect(propose(`${last} 23:59`).dateValue).toBe(`${last} 23:59`);
        },
        { now: () => NOW },
      );
    },
  );

  it("says which days it takes when it refuses", async () => {
    await withStore(
      (store) => {
        const poll = openDatePoll(store);
        const message = (line: string) => {
          try {
            store.proposeDate(poll.id, "u-member", line, LA);
          } catch (error) {
            return isPollError(error) ? error.message : "";
          }
          return "accepted";
        };
        expect(message("2026-11-17")).toBe(
          "Tue, 17 Nov 2026 · 11:00 is in the past: today is 2026-11-18 in America/Los_Angeles. Propose a day from 2026-11-18 to 2026-12-19.",
        );
        expect(message("2026-12-20")).toBe(
          "Sun, 20 Dec 2026 · 11:00 is more than 31 days away. Propose a day from 2026-11-18 to 2026-12-19, or ask an admin to plan further ahead.",
        );
      },
      { now: () => NOW },
    );
  });

  it("refuses a date that is not one, the same date and time, and a full poll, changing nothing", async () => {
    await withStore(
      (store) => {
        const poll = openDatePoll(store);
        const propose = (line: string) =>
          store.proposeDate(poll.id, "u-member", line, LA);
        expectCode(() => propose("next Saturday"), "invalid_date");
        expectCode(() => propose("2026-11-31"), "invalid_date");
        expectCode(() => propose("2026-11-28"), "duplicate_option");
        expectCode(() => propose("2026-11-28 11:00"), "duplicate_option");
        expect(store.getPoll(poll.id)?.options.length).toBe(2);
        // The same day at another time is another option.
        expect(propose("2026-11-28 08:30").label).toBe(
          "Sat, 28 Nov 2026 · 08:30",
        );
        for (let i = 0; i < 22; i++) {
          propose(`${addDays("2026-11-20", i)} 07:00`);
        }
        expect(store.getPoll(poll.id)?.options.length).toBe(MAX_OPTIONS);
        expectCode(() => propose("2026-12-19"), "too_many_options");
        expect(store.getPoll(poll.id)?.options.length).toBe(MAX_OPTIONS);
      },
      { now: () => NOW },
    );
  });

  it("refuses a closed poll, a location poll and an unknown poll", async () => {
    await withStore(
      (store) => {
        const poll = openDatePoll(store);
        store.closePoll(poll.id, "u-admin");
        expectCode(
          () => store.proposeDate(poll.id, "u-member", "2026-11-29", LA),
          "poll_closed",
        );
        expect(store.getPoll(poll.id)?.options.length).toBe(2);
        const round = store.startRound("u-admin", locations("A"));
        expectCode(
          () =>
            store.proposeDate(
              round.locationPoll?.id ?? 0,
              "u-member",
              "2026-11-29",
              LA,
            ),
          "invalid_state",
        );
        expectCode(
          () => store.proposeDate(999, "u-member", "2026-11-29", LA),
          "poll_not_found",
        );
      },
      { now: () => NOW },
    );
  });

  it("keeps the votes cast before and lists the options by date", async () => {
    await withStore(
      (store) => {
        const poll = openDatePoll(store);
        const [first, second] = poll.options;
        store.setVotes(poll.id, "u1", [first?.id ?? 0, second?.id ?? 0]);
        store.setVotes(poll.id, "u2", [second?.id ?? 0]);
        const added = store.proposeDate(poll.id, "u-member", "2026-12-05", LA);
        expect(added).toMatchObject({
          label: "Sat, 5 Dec 2026 · 11:00",
          proposedBy: "u-member",
          votes: 0,
        });
        const after = store.getPoll(poll.id, "u1");
        expect(after?.options.map((o) => [o.label, o.votes])).toEqual([
          ["Sat, 28 Nov 2026 · 11:00", 1],
          ["Sat, 5 Dec 2026 · 11:00", 0],
          ["Sat, 12 Dec 2026 · 11:00", 2],
        ]);
        expect(after?.viewerVotes).toEqual([first?.id, second?.id]);
        expect(after?.voterCount).toBe(2);
      },
      { now: () => NOW },
    );
  });
});

describe("withdrawDatePoll", () => {
  it("deletes the open date poll and returns the round to location_decided", async () => {
    await withStore((store, storage) => {
      const round = decidedRound(store);
      const poll = store.startDatePoll(round.id, "u-admin", dates(3));
      store.setVotes(poll.id, "u1", [poll.options[0]?.id ?? 0]);
      expect(store.withdrawDatePoll(poll.id)).toMatchObject({
        id: round.id,
        status: "location_decided",
        datePoll: null,
      });
      expect(store.getPoll(poll.id)).toBeNull();
      expect(count(storage, "polls")).toBe(1);
      expect(count(storage, "poll_options")).toBe(2);
      expect(count(storage, "poll_votes")).toBe(1);
      expect(store.startDatePoll(round.id, "u-admin", dates(2)).status).toBe(
        "open",
      );
    });
  });

  it("refuses a closed poll, an open location poll and an unknown poll", async () => {
    await withStore((store) => {
      const round = decidedRound(store);
      expectCode(
        () => store.withdrawDatePoll(round.locationPoll?.id ?? 0),
        "poll_closed",
      );
      const poll = store.startDatePoll(round.id, "u-admin", dates(2));
      store.closePoll(poll.id, "u-admin");
      expectCode(() => store.withdrawDatePoll(poll.id), "poll_closed");
      expectCode(() => store.withdrawDatePoll(999), "poll_not_found");
      const next = store.startRound("u-admin", locations("A"));
      expectCode(
        () => store.withdrawDatePoll(next.locationPoll?.id ?? 0),
        "invalid_state",
      );
    });
  });

  it("rolls back every row when a delete fails part-way", async () => {
    await withStore((store, storage) => {
      const round = decidedRound(store);
      const poll = store.startDatePoll(round.id, "u-admin", dates(2));
      storage.sql.exec(
        `CREATE TRIGGER fail_delete BEFORE DELETE ON polls
         BEGIN SELECT RAISE(ABORT, 'forced'); END`,
      );
      expect(() => store.withdrawDatePoll(poll.id)).toThrow(/forced/);
      storage.sql.exec("DROP TRIGGER fail_delete");
      expect(store.getPoll(poll.id)?.options).toHaveLength(2);
      expect(store.getActiveRound()?.status).toBe("date_voting");
    });
  });
});

describe("withdrawLocationRound", () => {
  it("closes the open location poll without a winner and cancels the round", async () => {
    await withStore(
      (store) => {
        const round = store.startRound("u-admin", locations("Ridge"));
        const pollId = round.locationPoll?.id ?? 0;
        expect(store.withdrawLocationRound(pollId, "u-admin")).toMatchObject({
          id: round.id,
          status: "cancelled",
          endedBy: "u-admin",
          endedAt: 1_800_000_001_000,
          locationPoll: {
            status: "closed",
            winnerOptionId: null,
            closedBy: "u-admin",
            closedAt: 1_800_000_001_000,
          },
        });
        expect(store.getActiveRound()).toBeNull();
      },
      { now: clock(1_800_000_000_000, 1000) },
    );
  });

  it("leaves a round that was cancelled meanwhile as it is", async () => {
    await withStore((store) => {
      const round = store.startRound("u-admin", locations("Ridge"));
      const pollId = round.locationPoll?.id ?? 0;
      const cancelled = store.cancelRound(round.id, "u-other");
      expectCode(
        () => store.withdrawLocationRound(pollId, "u-admin"),
        "poll_closed",
      );
      expect(store.getRound(round.id)).toEqual(cancelled);
    });
  });

  it("leaves a round whose location was decided meanwhile as it is", async () => {
    await withStore((store) => {
      const round = decidedRound(store);
      const before = store.getRound(round.id);
      expectCode(
        () => store.withdrawLocationRound(round.locationPoll?.id ?? 0, "u-1"),
        "poll_closed",
      );
      expect(store.getRound(round.id)).toEqual(before);
      expect(before).toMatchObject({
        status: "location_decided",
        locationOptionId: round.locationPoll?.options[0]?.id,
      });
    });
  });

  it("refuses an open date poll and an unknown poll", async () => {
    await withStore((store) => {
      const round = decidedRound(store);
      const poll = store.startDatePoll(round.id, "u-admin", dates(2));
      expectCode(
        () => store.withdrawLocationRound(poll.id, "u-admin"),
        "invalid_state",
      );
      expect(store.getRound(round.id)?.status).toBe("date_voting");
      expectCode(
        () => store.withdrawLocationRound(999, "u-admin"),
        "poll_not_found",
      );
    });
  });

  it("rolls back the poll's close when cancelling the round fails", async () => {
    await withStore((store, storage) => {
      const round = store.startRound("u-admin", locations("Ridge"));
      const pollId = round.locationPoll?.id ?? 0;
      storage.sql.exec(
        `CREATE TRIGGER fail_cancel BEFORE UPDATE ON rounds
         BEGIN SELECT RAISE(ABORT, 'forced'); END`,
      );
      expect(() => store.withdrawLocationRound(pollId, "u-admin")).toThrow(
        /forced/,
      );
      storage.sql.exec("DROP TRIGGER fail_cancel");
      expect(store.getPoll(pollId)?.status).toBe("open");
      expect(store.getActiveRound()?.status).toBe("location_voting");
    });
  });
});

describe("round lifecycle", () => {
  it("runs from location vote to complete", async () => {
    await withStore((store) => {
      const round = decidedRound(store);
      const datePoll = store.startDatePoll(round.id, "u-admin", dates(3));
      const winner = datePoll.options[2]?.id ?? 0;
      store.setVotes(datePoll.id, "u1", [winner]);
      store.closePoll(datePoll.id, "u-admin");
      expect(store.getActiveRound()).toBeNull();
      expect(store.getLastRound()).toMatchObject({
        status: "complete",
        locationOptionId: round.locationPoll?.options[0]?.id,
        dateOptionId: winner,
        endedBy: "u-admin",
      });
      expectCode(() => store.cancelRound(round.id, "u-admin"), "invalid_state");
      expect(store.startRound("u-admin").status).toBe("location_voting");
    });
  });

  it.each(["location_voting", "location_decided", "date_voting"] as const)(
    "can be cancelled during %s, after which a new round starts",
    async (stage) => {
      await withStore((store) => {
        const round = store.startRound("u-admin", locations("A", "B"));
        if (stage !== "location_voting") {
          store.closePoll(round.locationPoll?.id ?? 0, "u-admin");
        }
        if (stage === "date_voting") {
          store.startDatePoll(round.id, "u-admin", dates(2));
        }
        expect(store.getActiveRound()?.status).toBe(stage);

        const cancelled = store.cancelRound(round.id, "u-admin");
        expect(cancelled).toMatchObject({
          status: "cancelled",
          endedBy: "u-admin",
        });
        const polls = [cancelled.locationPoll, cancelled.datePoll].filter(
          (poll) => poll !== null,
        );
        expect(polls.every((poll) => poll.status === "closed")).toBe(true);
        const openPoll =
          stage === "location_voting"
            ? cancelled.locationPoll
            : stage === "date_voting"
              ? cancelled.datePoll
              : null;
        if (openPoll) {
          expect(openPoll.winnerOptionId).toBeNull();
          expect(openPoll.closedBy).toBe("u-admin");
        }
        expect(cancelled.dateOptionId).toBeNull();
        expectCode(
          () => store.cancelRound(round.id, "u-admin"),
          "invalid_state",
        );
        expect(store.getActiveRound()).toBeNull();
        expect(store.startRound("u-admin").status).toBe("location_voting");
      });
    },
  );

  it("fails to cancel an unknown round", async () => {
    await withStore((store) => {
      expectCode(() => store.cancelRound(1, "u-admin"), "round_not_found");
    });
  });
});

describe("message and thread ids", () => {
  it("records the poll message and the round thread", async () => {
    await withStore((store) => {
      const round = store.startRound("u-admin");
      const pollId = round.locationPoll?.id ?? 0;
      store.setPollMessage(pollId, "c1", "m1");
      store.setRoundThread(round.id, "t1");
      expect(store.getPoll(pollId)).toMatchObject({
        channelId: "c1",
        messageId: "m1",
      });
      expect(store.getActiveRound()?.threadId).toBe("t1");
      expectCode(() => {
        store.setPollMessage(999, "c", "m");
      }, "poll_not_found");
      expectCode(() => {
        store.setRoundThread(999, "t");
      }, "round_not_found");
    });
  });
});

describe("transactions", () => {
  it("leaves no partial rows when a write fails part-way", async () => {
    await withStore((store, storage) => {
      storage.sql.exec("ALTER TABLE poll_options RENAME TO poll_options_off");
      expect(() => store.startRound("u-admin", locations("A"))).toThrow();
      storage.sql.exec("ALTER TABLE poll_options_off RENAME TO poll_options");
      expect(count(storage, "rounds")).toBe(0);
      expect(count(storage, "polls")).toBe(0);

      const round = decidedRound(store);
      storage.sql.exec("ALTER TABLE poll_options RENAME TO poll_options_off");
      expect(() =>
        store.startDatePoll(round.id, "u-admin", dates(2)),
      ).toThrow();
      storage.sql.exec("ALTER TABLE poll_options_off RENAME TO poll_options");
      expect(count(storage, "polls")).toBe(1);
      expect(store.getActiveRound()?.status).toBe("location_decided");
    });
  });

  it("rolls back a vote replacement that fails part-way", async () => {
    await withStore((store, storage) => {
      const poll = store.startRound(
        "u-admin",
        locations("A", "B"),
      ).locationPoll;
      const [a, b] = (poll?.options ?? []).map((o) => o.id);
      const pollId = poll?.id ?? 0;
      store.setVotes(pollId, "u1", [a ?? 0]);
      storage.sql.exec(
        `CREATE TRIGGER fail_vote BEFORE INSERT ON poll_votes
         WHEN NEW.option_id = ${String(b)}
         BEGIN SELECT RAISE(ABORT, 'forced'); END`,
      );
      expect(() => store.setVotes(pollId, "u1", [a ?? 0, b ?? 0])).toThrow(
        /forced/,
      );
      storage.sql.exec("DROP TRIGGER fail_vote");
      expect(store.getPoll(pollId, "u1")?.viewerVotes).toEqual([a]);
    });
  });
});

describe("listHikes", () => {
  it("returns only completed rounds, with their location, date, thread and polls", async () => {
    const { hikes, total, rounds } = await withStore((store, storage) => {
      const id = completeRound(store, "Ridge", "2030-06-15 09:00", "Steep");
      store.setRoundThread(id, "600000000000000001");
      const round = store.getRound(id);
      store.setPollMessage(round?.locationPoll?.id ?? 0, "300", "701");
      store.setPollMessage(round?.datePoll?.id ?? 0, "300", "702");
      const cancelled = store.startRound("u-admin", locations("Lake"));
      store.cancelRound(cancelled.id, "u-admin");
      store.startRound("u-admin", locations("Active"));
      return {
        hikes: store.listHikes({ limit: 10, offset: 0 }),
        total: store.countHikes(),
        rounds: count(storage, "rounds"),
      };
    });
    expect(rounds).toBe(3);
    expect(total).toBe(1);
    expect(hikes).toEqual([
      {
        roundId: 1,
        location: {
          label: "Ridge",
          details: "Steep",
          proposedBy: "u-proposer",
        },
        date: { value: "2030-06-15 09:00", label: "Sat, 15 Jun 2030 · 09:00" },
        threadId: "600000000000000001",
        completedAt: expect.any(Number) as number,
        locationPoll: { channelId: "300", messageId: "701" },
        datePoll: { channelId: "300", messageId: "702" },
      },
    ]);
  });

  it("records when the round completed and leaves unposted polls null", async () => {
    const { hike, round } = await withStore(
      (store) => {
        const id = completeRound(store, "Ridge", "2030-06-15");
        return {
          hike: store.listHikes({ limit: 1, offset: 0 })[0],
          round: store.getRound(id),
        };
      },
      { now: clock(1_900_000_000_000, 1000) },
    );
    expect(hike?.completedAt).toBe(round?.endedAt);
    expect(hike?.completedAt).toBe(round?.datePoll?.closedAt);
    expect(hike?.threadId).toBeNull();
    expect(hike?.location.details).toBeNull();
    expect(hike?.locationPoll).toEqual({ channelId: null, messageId: null });
    expect(hike?.datePoll).toEqual({ channelId: null, messageId: null });
  });

  it("orders by the decided date, newest first, not by when rounds completed", async () => {
    const labels = await withStore((store) => {
      completeRound(store, "June", "2030-06-15");
      completeRound(store, "March", "2030-03-01");
      completeRound(store, "June evening", "2030-06-15 18:00");
      completeRound(store, "December", "2030-12-05");
      completeRound(store, "June again", "2030-06-15");
      return store
        .listHikes({ limit: 10, offset: 0 })
        .map((hike) => hike.location.label);
    });
    expect(labels).toEqual([
      "December",
      "June evening",
      "June again",
      "June",
      "March",
    ]);
  });

  it("pages with limit and offset", async () => {
    const { pages, total } = await withStore((store) => {
      for (let day = 1; day <= 5; day++) {
        completeRound(store, `Day ${String(day)}`, `2030-01-0${String(day)}`);
      }
      const page = (limit: number, offset: number) =>
        store.listHikes({ limit, offset }).map((hike) => hike.location.label);
      return {
        pages: [page(2, 0), page(2, 2), page(2, 4), page(2, 6), page(0, 0)],
        total: store.countHikes(),
      };
    });
    expect(pages).toEqual([
      ["Day 5", "Day 4"],
      ["Day 3", "Day 2"],
      ["Day 1"],
      [],
      [],
    ]);
    expect(total).toBe(5);
  });

  it("is empty without completed rounds", async () => {
    const { hikes, total } = await withStore((store) => {
      const round = store.startRound("u-admin", locations("Ridge"));
      store.cancelRound(round.id, "u-admin");
      return {
        hikes: store.listHikes({ limit: 10, offset: 0 }),
        total: store.countHikes(),
      };
    });
    expect(hikes).toEqual([]);
    expect(total).toBe(0);
  });
});

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
      playRound(
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
      playRound(store, locations("Ridge"), "Ridge", "2030-06-08");
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
      playRound(
        store,
        locations("Eagle Peak", "Lake"),
        "Eagle Peak",
        "2026-12-05",
      );
      expect(store.restingLocations()).toEqual([
        {
          label: "Eagle Peak",
          key: "eagle peak",
          hikedOn: "Sat, 5 Dec 2026 · 11:00",
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
        "**Eagle Peak** was the hike on Sat, 5 Dec 2026 · 11:00. It can be suggested again after 2 more hikes.",
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
      playRound(store, locations("Lake", "Ridge"), "Lake", "2027-01-09 08:30");
      expect(
        store.restingLocations().map((r) => [r.label, r.hikesLeft, r.hikedOn]),
      ).toEqual([
        ["Lake", 2, "Sat, 9 Jan 2027 · 11:00"],
        ["Eagle Peak", 1, "Sat, 5 Dec 2026 · 11:00"],
      ]);

      // Round 4: Eagle Peak has one more hike to rest.
      const four = store.startRound("u-admin", locations("Ridge"));
      const fourPoll = four.locationPoll?.id ?? 0;
      expect(
        cooldownRefusal(() =>
          store.addOption(fourPoll, { label: "Eagle Peak", proposedBy: "u1" }),
        ),
      ).toBe(
        "**Eagle Peak** was the hike on Sat, 5 Dec 2026 · 11:00. It can be suggested again after 1 more hike.",
      );
      store.cancelRound(four.id, "u-admin");
      playRound(store, locations("Ridge"), "Ridge", "2027-02-06");

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
      playRound(store, locations("Ridge"), "Ridge", "2030-06-08");
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
      cooldownMessage({
        ...resting,
        hikedOn: "Sun, 6 Dec 2026 · 11:00",
        hikesLeft: 2,
      }),
    ).toBe(
      "**Ridge** was the hike on Sun, 6 Dec 2026 · 11:00. It can be suggested again after 2 more hikes.",
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
