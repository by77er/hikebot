/** Style guide: Tally vote, the votable form, short and at 25 options. */
import type { Preview } from "../../components/button";
import { TallyRow } from "../../components/tally-row";
import { TallyVote } from "../../components/tally-vote";
import {
  DATE_INSTRUCTIONS,
  DATES,
  LOCATION_INSTRUCTIONS,
  LOCATION_VOTERS,
  LOCATIONS,
} from "./samples";
import { Section, StateList, type StyleguideSection } from "./section";

const STATES: { state: string; checked: boolean; preview?: Preview }[] = [
  { state: "Not voted", checked: false },
  { state: "Voted", checked: true },
  { state: "Hover", checked: false, preview: "hover" },
  { state: "Focus visible", checked: true, preview: "focus" },
];

/** The style guide's forms post nowhere real. */
const ACTION = "/styleguide/tally-vote";

function TallyVoteSection() {
  return (
    <Section
      id="tally-vote"
      title="Tally vote"
      intro="The votable tally: each option's label is a real checkbox's label, checked for the viewer's saved votes, in a form whose Vote button posts them without JavaScript. The checkbox replaces the row's own Your vote mark."
    >
      <h3>A votable row in each state</h3>
      <StateList
        examples={STATES.map(({ state, checked, preview }) => ({
          state,
          example: (
            <TallyRow
              option={{
                id: state,
                label: "Lake Serene",
                proposer: "kestrel_hikes",
                votes: checked ? 5 : 4,
                yourVote: checked,
              }}
              voterCount={9}
              choice={{ name: "option" }}
              preview={preview}
            />
          ),
        }))}
      />
      <h3>Date vote, one vote saved</h3>
      <TallyVote
        action={ACTION}
        label="Dates"
        instructions={DATE_INSTRUCTIONS}
        options={DATES}
        voterCount={7}
      />
      <h3>No options yet</h3>
      <TallyVote
        action={ACTION}
        label="Locations"
        instructions={LOCATION_INSTRUCTIONS}
        options={[]}
        voterCount={0}
        empty="There are no locations to vote for yet. Propose one first."
      />
      <h3>Location vote with 25 options</h3>
      <TallyVote
        action={ACTION}
        label="Locations"
        instructions={LOCATION_INSTRUCTIONS}
        options={LOCATIONS}
        voterCount={LOCATION_VOTERS}
      />
    </Section>
  );
}

export const tallyVoteSection: StyleguideSection = {
  id: "tally-vote",
  title: "Tally vote",
  render: TallyVoteSection,
  ownPage: true,
};
