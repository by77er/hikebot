import { afterEach, describe, expect, it, vi } from "vitest";
import { completeRound } from "../polls/helpers";
import { OWNER, pinRound, viewAfter } from "./view-after";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the web view's place of the planned hike", () => {
  it("has the pin given for the location, with the links the thread shows", async () => {
    let roundId = 0;
    const { view } = await viewAfter(802, (store) => {
      roundId = completeRound(store, "Mailbox Peak", "2030-06-15");
      pinRound(store, roundId, { lat: 47.4875, lon: -121.7234 });
    });
    expect(view.hikePlace).toEqual({
      roundId,
      pin: {
        lat: 47.4875,
        lon: -121.7234,
        text: "47.4875, -121.7234",
        name: null,
        osmUrl:
          "https://www.openstreetmap.org/?mlat=47.4875&mlon=-121.7234#map=13/47.4875/-121.7234",
        googleUrl:
          "https://www.google.com/maps/search/?api=1&query=47.4875,-121.7234",
      },
      lookingUp: false,
      pinnable: true,
    });
  });

  it("has the place name the geocoder found", async () => {
    const { view } = await viewAfter(802, (store) => {
      const round = completeRound(store, "Mailbox Peak", "2030-06-15");
      const optionId = store.getRound(round)?.locationOptionId ?? 0;
      store.recordPlaceLookup(optionId, {
        kind: "found",
        point: { lat: 47.46, lon: -121.67 },
        name: "Mailbox Peak, King County",
      });
    });
    expect(view.hikePlace?.pin).toMatchObject({
      name: "Mailbox Peak, King County",
      text: "47.46, -121.67",
    });
  });

  it("says the pin is still being looked up, and has none once cleared", async () => {
    const looking = await viewAfter(802, (store) => {
      completeRound(store, "Mailbox Peak", "2030-06-15");
    });
    expect(looking.view.hikePlace).toMatchObject({
      pin: null,
      lookingUp: true,
    });
    const cleared = await viewAfter(802, (store) => {
      const round = completeRound(store, "Mailbox Peak", "2030-06-15");
      pinRound(store, round, null);
    });
    expect(cleared.view.hikePlace).toMatchObject({
      pin: null,
      lookingUp: false,
      pinnable: true,
    });
  });

  it("cannot be pinned once a new round has decided its location, as in the panel", async () => {
    const { view } = await viewAfter(802, (store) => {
      completeRound(store, "Mailbox Peak", "2030-06-15");
      const next = store.startRound(OWNER, [
        { label: "Lake", proposedBy: OWNER },
      ]);
      const poll = next.locationPoll;
      if (!poll) throw new Error("no location poll");
      store.setVotes(poll.id, OWNER, [poll.options[0]?.id ?? 0]);
      store.closePoll(poll.id, OWNER);
    });
    expect(view.hikePlace?.pinnable).toBe(false);
  });

  it("is null with no planned hike", async () => {
    const { view } = await viewAfter(802, () => undefined);
    expect(view.hikePlace).toBeNull();
  });
});
