import { describe, expect, it } from "vitest";
import {
  COLLAPSE_AFTER,
  TallyList,
  votersText,
} from "../../../src/web/components/tally-list";
import type { TallyOption } from "../../../src/web/components/tally-row";
import { render, spokenText } from "./render";

function options(count: number): TallyOption[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    label: `Location ${String(index + 1)}`,
    details: `Details ${String(index + 1)}`,
    proposer: "Ana",
    votes: count - index,
  }));
}

describe("votersText", () => {
  it("says how many members voted, in the bot's words", () => {
    expect(votersText(0)).toBe("No one has voted yet.");
    expect(votersText(1)).toBe("1 member has voted.");
    expect(votersText(14)).toBe("14 members have voted.");
  });
});

describe("TallyList", () => {
  it("lists every option as a row, in the order given, under the voter line", async () => {
    const html = render(
      <TallyList label="Locations" options={options(3)} voterCount={4} />,
    );
    expect(html).toMatch(
      /^<div class="tally-list"><p class="tally-list__voters">4 members have voted.<\/p><ol class="tally-list__rows" aria-label="Locations">/,
    );
    expect(html.match(/<li class="tally-list__item">/g)).toHaveLength(3);
    const labels = [
      ...html.matchAll(/<p class="tally-row__label">([^<]*)</g),
    ].map(([, label]) => label);
    expect(labels).toEqual(["Location 1", "Location 2", "Location 3"]);
    expect(await spokenText(html)).toMatch(
      /^4 members have voted. Locations Location 1 3 votes Details 1 Proposed by Ana/,
    );
  });

  it("says the empty sentence, and nothing else, when there are no options", () => {
    expect(
      render(
        <TallyList
          label="Locations"
          options={[]}
          voterCount={0}
          empty="There are no locations to vote for yet. Propose one first."
        />,
      ),
    ).toBe(
      '<p class="tally-list__empty">There are no locations to vote for yet. Propose one first.</p>',
    );
  });

  it("marks the winner, with the tie note on its row only", () => {
    const html = render(
      <TallyList
        label="Locations"
        options={options(3)}
        voterCount={4}
        winnerId="2"
        tiedOptions={2}
      />,
    );
    expect(html.match(/tally-row--winner/g)).toHaveLength(1);
    expect(html.match(/tally-row__tie/g)).toHaveLength(1);
    expect(html).toMatch(
      /tally-row--winner"><div class="tally-row__head"><p class="tally-row__label">Location 2</,
    );
  });

  it(`shows the details of up to ${String(COLLAPSE_AFTER)} options, and folds them past that`, () => {
    const few = render(
      <TallyList
        label="Locations"
        options={options(COLLAPSE_AFTER)}
        voterCount={9}
      />,
    );
    expect(few).not.toContain("<details");
    const many = render(
      <TallyList label="Locations" options={options(25)} voterCount={30} />,
    );
    expect(many.match(/<li class="tally-list__item">/g)).toHaveLength(25);
    expect(many.match(/<details class="tally-row__more">/g)).toHaveLength(25);
  });

  it("makes every row a checkbox under one name when given a choice", () => {
    const html = render(
      <TallyList
        label="Dates"
        options={options(2)}
        voterCount={3}
        choice={{ name: "option" }}
      />,
    );
    expect(html.match(/type="checkbox"[^>]* name="option"/g)).toHaveLength(2);
  });
});
