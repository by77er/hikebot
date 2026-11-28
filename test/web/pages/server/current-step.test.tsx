import { describe, expect, it } from "vitest";
import { CurrentStep } from "../../../../src/web/pages/server/current-step";
import { render, spokenText } from "../../components/render";
import {
  baseView,
  FORMS,
  MARKUP,
  openVote,
  plannedHike,
  GUILD,
  round,
  schedule,
  TIME_ZONE,
} from "./view";

const MESSAGE = /href="https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+"/;

describe("CurrentStep", () => {
  it("shows an open location vote as a form to vote with, and links the vote in Discord", async () => {
    const vote = openVote("location", [
      { label: "Lake", votes: 3 },
      { label: "Ridge", votes: 1 },
    ]);
    const html = render(
      <CurrentStep
        forms={FORMS}
        view={baseView({ round: round("location_vote_open", vote) })}
      />,
    );
    const text = await spokenText(html);
    expect(text).toContain("Location vote");
    expect(text).toContain("Open");
    expect(text).toContain(
      "Vote for every location you would go to; you can change your votes until the vote closes.",
    );
    expect(text).toContain("Lake 3 votes");
    expect(text).toContain("Ridge 1 vote");
    expect(html).toContain(
      `<form class="tally-vote" method="post" action="/g/${GUILD}/polls/1/votes">`,
    );
    expect(html).toContain('<input type="hidden" name="csrf" value="token"/>');
    expect([...html.matchAll(/type="checkbox"/g)]).toHaveLength(2);
    expect(html).not.toContain("checked");
    expect(text).toContain("Save votes");
    expect(html).toMatch(MESSAGE);
    expect(text).toContain("See the vote in Discord");
    expect(text).toContain(
      "Open The location vote closes when an admin closes it. Vote for",
    );
    expect(text).toContain("3 members have voted. Counted just now. Locations");
  });

  it("says when the schedule closes the vote, as the bot writes times, in the vote's card", async () => {
    const vote = openVote("location", [{ label: "Lake", votes: 3 }]);
    const text = await spokenText(
      render(
        <CurrentStep
          forms={FORMS}
          view={baseView({
            round: round("location_vote_open", vote),
            schedule: schedule(),
          })}
        />,
      ),
    );
    expect(text).toContain(
      "Open The location vote closes Wed, 5 Jun 2030 · 09:00, and the date vote opens. Vote for",
    );
  });

  it("ticks the viewer's own votes", () => {
    const vote = openVote("location", [
      { label: "Lake", votes: 3, viewerVoted: true },
      { label: "Ridge", votes: 1 },
    ]);
    const html = render(
      <CurrentStep
        forms={FORMS}
        view={baseView({ round: round("location_vote_open", vote) })}
      />,
    );
    expect(html).toMatch(/name="option" value="1" checked/);
    expect(html).not.toMatch(/name="option" value="2" checked/);
  });

  it("shows a refused save with the bot's sentence and the boxes as they were sent", async () => {
    const vote = openVote("location", [
      { label: "Lake", votes: 3, viewerVoted: true },
      { label: "Ridge", votes: 1 },
    ]);
    const html = render(
      <CurrentStep
        forms={{
          csrf: "token",
          refusal: {
            form: "votes",
            pollId: 1,
            code: "unknown_option",
            message: "That option is not in this poll.",
            optionIds: [2],
          },
        }}
        view={baseView({ round: round("location_vote_open", vote) })}
      />,
    );
    const text = await spokenText(html);
    expect(text).toContain(
      "Error Your votes were not saved. That option is not in this poll.",
    );
    expect(html).not.toMatch(/name="option" value="1" checked/);
    expect(html).toMatch(/name="option" value="2" checked/);
  });

  it("says the vote's message is still being posted when it has none", async () => {
    const vote = openVote("location", [{ label: "Lake", votes: 0 }], null);
    const html = render(
      <CurrentStep
        forms={FORMS}
        view={baseView({ round: round("location_vote_open", vote) })}
      />,
    );
    expect(html).not.toContain("See the vote in Discord");
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
        forms={FORMS}
        view={baseView({
          round: round("date_vote_open", vote, "Mailbox Peak"),
        })}
      />,
    );
    const text = await spokenText(html);
    expect(text).toContain("Date vote");
    expect(text).toContain("Where: Mailbox Peak");
    expect(text).toContain(`Times are in ${TIME_ZONE}.`);
    expect(text).toContain("Sat, 15 Jun 2030 · 09:00 2 votes");
    expect(html).toMatch(/name="option" value="1" checked/);
    expect(text).not.toContain("America/Los_Angeles");
  });

  it("says a decided location waits for its date vote", async () => {
    const view = baseView({
      round: round("location_decided", null, "Mailbox Peak"),
    });
    const text = await spokenText(
      render(<CurrentStep view={view} forms={FORMS} />),
    );
    expect(text).toContain("Decided");
    expect(text).toContain("Mailbox Peak won the location vote.");
    expect(text).toContain("The date vote is next.");
    expect(text).not.toContain("/hike admin");
    const admin = await spokenText(
      render(
        <CurrentStep
          view={{ ...view, viewer: { ...view.viewer, isAdmin: true } }}
          forms={FORMS}
        />,
      ),
    );
    expect(admin).toContain(
      "start it in Discord with /hike admin, then Start date vote.",
    );
  });

  it("shows an empty state with no round, with the admin hint for an admin", async () => {
    const view = baseView();
    const member = await spokenText(
      render(<CurrentStep view={view} forms={FORMS} />),
    );
    expect(member).toContain("No hike is being planned");
    expect(member).not.toContain("/hike admin");
    const admin = await spokenText(
      render(
        <CurrentStep
          view={{ ...view, viewer: { ...view.viewer, isAdmin: true } }}
          forms={FORMS}
        />,
      ),
    );
    expect(admin).toContain(
      "start one in Discord with /hike admin, then Start location vote.",
    );
  });

  it("shows nothing with no round and a planned hike", () => {
    expect(
      render(
        <CurrentStep
          view={baseView({ plannedHike: plannedHike() })}
          forms={FORMS}
        />,
      ),
    ).toBe("");
  });

  it("shows labels and details with markup in them as text", () => {
    const vote = openVote("location", [
      { label: MARKUP, votes: 1, details: MARKUP },
    ]);
    const html = render(
      <CurrentStep
        forms={FORMS}
        view={baseView({ round: round("location_vote_open", vote) })}
      />,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
  });
});
