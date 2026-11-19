import { describe, expect, it } from "vitest";
import { TallyVote } from "../../../src/web/components/tally-vote";
import { render, spokenText } from "./render";

const INSTRUCTIONS =
  "Vote for every date you could make; you can change your votes until the vote closes.";

const DATES = [
  { id: "d1", label: "Sat, 5 Dec 2026 · 11:00", votes: 2, yourVote: true },
  { id: "d2", label: "Sun, 6 Dec 2026 · 11:00", votes: 0 },
];

describe("TallyVote", () => {
  it("is a form that posts the checked options, without JavaScript", async () => {
    const html = render(
      <TallyVote
        action="/g/1/vote"
        label="Dates"
        instructions={INSTRUCTIONS}
        options={DATES}
        voterCount={2}
        hidden={<input type="hidden" name="csrf" value="token" />}
      />,
    );
    expect(html).toMatch(
      /^<form class="tally-vote" method="post" action="\/g\/1\/vote"><input type="hidden" name="csrf" value="token"\/><fieldset class="tally-vote__fieldset"><legend class="tally-vote__legend">Vote for every date you could make;/,
    );
    expect(html).toMatch(
      /type="checkbox" id="[^"]+" name="option" value="d1" checked/,
    );
    expect(html).toMatch(
      /type="checkbox" id="[^"]+" name="option" value="d2" aria-describedby/,
    );
    expect(html).toContain(
      '<div class="tally-vote__actions"><button class="button button--primary" type="submit">',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/\son[a-z]+=/);
    expect(await spokenText(html)).toMatch(
      /2 members have voted\. Dates Sat, 5 Dec 2026 · 11:00 2 votes Sun, 6 Dec 2026 · 11:00 0 votes Vote$/,
    );
  });

  it("sends the options under the name it is given", () => {
    const html = render(
      <TallyVote
        action="/v"
        name="date"
        label="Dates"
        instructions={INSTRUCTIONS}
        options={DATES}
        voterCount={2}
      />,
    );
    expect(html.match(/name="date"/g)).toHaveLength(2);
  });

  it("is no form when there is nothing to vote for", () => {
    const html = render(
      <TallyVote
        action="/v"
        label="Locations"
        instructions={INSTRUCTIONS}
        options={[]}
        voterCount={0}
        empty="There are no locations to vote for yet. Propose one first."
      />,
    );
    expect(html).toBe(
      '<p class="tally-list__empty">There are no locations to vote for yet. Propose one first.</p>',
    );
  });
});
