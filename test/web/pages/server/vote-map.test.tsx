import { describe, expect, it } from "vitest";
import { VoteMap } from "../../../../src/web/pages/server/vote-map";
import { render, spokenText } from "../../components/render";
import { baseView, MARKUP, openVote, pinAt, round } from "./view";

const LOCATED = [
  { label: "Mount Si", votes: 4, place: pinAt(47.5069, -121.739) },
  { label: "Lake Serene", votes: 2 },
  { label: "Little Si", votes: 1, place: pinAt(47.4987, -121.756) },
];

describe("VoteMap", () => {
  it("numbers the located options in the vote's order, on the map and in its list", async () => {
    const view = baseView({
      round: round("location_vote_open", openVote("location", LOCATED)),
    });
    const html = render(<VoteMap view={view} />);
    const text = await spokenText(html);
    expect(text).toContain("Proposed locations on the map");
    expect(text).toContain(
      "Mount Si 47.5069° N, 121.7390° W Little Si 47.4987° N, 121.7560° W",
    );
    expect(text).not.toContain("Lake Serene");
    expect(html).toContain(
      "&quot;label&quot;:&quot;Little Si&quot;,&quot;number&quot;:2",
    );
    // There is no picture to show without JavaScript.
    expect(text).toContain("Turn on JavaScript to see the map.");
  });

  it("shows nothing while no option has a place", () => {
    const view = baseView({
      round: round(
        "location_vote_open",
        openVote("location", [{ label: "Lake Serene", votes: 1 }]),
      ),
    });
    expect(render(<VoteMap view={view} />)).toBe("");
  });

  it("shows nothing outside an open location vote", () => {
    for (const step of ["location_decided", "date_vote_open"] as const) {
      const view = baseView({
        round: round(step, openVote("location", LOCATED), "Mount Si"),
      });
      expect(render(<VoteMap view={view} />)).toBe("");
    }
    expect(render(<VoteMap view={baseView()} />)).toBe("");
    expect(
      render(
        <VoteMap
          view={baseView({ round: round("location_vote_open", null) })}
        />,
      ),
    ).toBe("");
  });

  it("puts a name with markup in it in as text", () => {
    const view = baseView({
      round: round(
        "location_vote_open",
        openVote("location", [
          { label: MARKUP, votes: 1, place: pinAt(47.5, -121.7) },
        ]),
      ),
    });
    const html = render(<VoteMap view={view} />);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
  });
});
