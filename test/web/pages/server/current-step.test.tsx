import { describe, expect, it } from "vitest";
import { CurrentStep } from "../../../../src/web/pages/server/current-step";
import { render, spokenText } from "../../components/render";
import {
  baseView,
  MARKUP,
  openVote,
  plannedHike,
  round,
  TIME_ZONE,
} from "./view";

const MESSAGE = /href="https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+"/;

describe("CurrentStep", () => {
  it("shows an open location vote's tally with Vote in Discord", async () => {
    const vote = openVote("location", [
      { label: "Lake", votes: 3 },
      { label: "Ridge", votes: 1 },
    ]);
    const html = render(
      <CurrentStep
        view={baseView({ round: round("location_vote_open", vote) })}
      />,
    );
    const text = await spokenText(html);
    expect(text).toContain("Location vote");
    expect(text).toContain("Open");
    expect(text).toContain("Lake 3 votes");
    expect(text).toContain("Ridge 1 vote");
    expect(text).toContain("You have not voted yet.");
    expect(text).not.toContain("Your vote");
    expect(html).toMatch(MESSAGE);
    expect(text).toContain("Vote in Discord");
  });

  it("marks the viewer's own votes", async () => {
    const vote = openVote("location", [
      { label: "Lake", votes: 3, viewerVoted: true },
      { label: "Ridge", votes: 1 },
    ]);
    const html = render(
      <CurrentStep
        view={baseView({ round: round("location_vote_open", vote) })}
      />,
    );
    const text = await spokenText(html);
    expect(text).toContain("Lake 3 votes Your vote");
    expect(text).not.toContain("Ridge 1 vote Your vote");
    expect(text).toContain("You have voted.");
  });

  it("says the vote's message is still being posted when it has none", async () => {
    const vote = openVote("location", [{ label: "Lake", votes: 0 }], null);
    const html = render(
      <CurrentStep
        view={baseView({ round: round("location_vote_open", vote) })}
      />,
    );
    expect(html).not.toContain("Vote in Discord");
    expect(await spokenText(html)).toContain(
      "The vote's message is being posted in Discord.",
    );
  });

  it("shows an open date vote with the location and the time zone", async () => {
    const vote = openVote("date", [
      { label: "Sat, 15 Jun 2030 · 09:00", votes: 2, viewerVoted: true },
    ]);
    const html = render(
      <CurrentStep
        view={baseView({
          round: round("date_vote_open", vote, "Mailbox Peak"),
        })}
      />,
    );
    const text = await spokenText(html);
    expect(text).toContain("Date vote");
    expect(text).toContain("Where: Mailbox Peak");
    expect(text).toContain(`Times are in ${TIME_ZONE}.`);
    expect(text).toContain("Sat, 15 Jun 2030 · 09:00 2 votes Your vote");
    expect(text).not.toContain("America/Los_Angeles");
  });

  it("says a decided location waits for its date vote", async () => {
    const view = baseView({
      round: round("location_decided", null, "Mailbox Peak"),
    });
    const text = await spokenText(render(<CurrentStep view={view} />));
    expect(text).toContain("Decided");
    expect(text).toContain("Mailbox Peak won the location vote.");
    expect(text).toContain("The date vote is next.");
    expect(text).not.toContain("/hike admin");
    const admin = await spokenText(
      render(
        <CurrentStep
          view={{ ...view, viewer: { ...view.viewer, isAdmin: true } }}
        />,
      ),
    );
    expect(admin).toContain(
      "start it with Start date vote in /hike admin in Discord",
    );
  });

  it("shows an empty state with no round, with the admin hint for an admin", async () => {
    const view = baseView();
    const member = await spokenText(render(<CurrentStep view={view} />));
    expect(member).toContain("No hike is being planned");
    expect(member).not.toContain("/hike admin");
    const admin = await spokenText(
      render(
        <CurrentStep
          view={{ ...view, viewer: { ...view.viewer, isAdmin: true } }}
        />,
      ),
    );
    expect(admin).toContain(
      "start one with Start location vote in /hike admin in Discord",
    );
  });

  it("shows nothing with no round and a planned hike", () => {
    expect(
      render(<CurrentStep view={baseView({ plannedHike: plannedHike() })} />),
    ).toBe("");
  });

  it("shows labels and details with markup in them as text", () => {
    const vote = openVote("location", [
      { label: MARKUP, votes: 1, details: MARKUP },
    ]);
    const html = render(
      <CurrentStep
        view={baseView({ round: round("location_vote_open", vote) })}
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
  });
});
