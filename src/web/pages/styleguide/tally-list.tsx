/** Style guide: Tally list, empty, short, and full at 25 options. */
import { TallyList } from "../../components/tally-list";
import { DATES, LOCATION_VOTERS, LOCATIONS } from "./samples";
import { Section, type StyleguideSection } from "./section";

function TallyListSection() {
  return (
    <Section
      id="tally-list"
      title="Tally list"
      intro="Every option of a vote under the number of members who voted, in the bot's order: locations by votes, dates by date. Past six options the details fold away, so 25 rows stay a column of names and counts."
    >
      <h3>No options yet</h3>
      <TallyList
        label="Locations"
        options={[]}
        voterCount={0}
        empty="There are no locations to vote for yet. Propose one first."
      />
      <h3>Date vote, open</h3>
      <TallyList label="Dates" options={DATES} voterCount={7} />
      <h3>Location vote, closed with 25 options and a tie</h3>
      <TallyList
        label="Locations"
        options={LOCATIONS}
        voterCount={LOCATION_VOTERS}
        winnerId="2"
        tiedOptions={3}
      />
    </Section>
  );
}

export const tallyListSection: StyleguideSection = {
  id: "tally-list",
  title: "Tally list",
  render: TallyListSection,
  ownPage: true,
};
