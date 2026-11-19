/** Style guide: Tally row in each state, one row at a time. */
import { TallyRow } from "../../components/tally-row";
import { LONGEST_DETAILS, LONGEST_LOCATION } from "./samples";
import { Section, type StyleguideSection } from "./section";

const EXAMPLES = [
  {
    state: "Open, no votes yet",
    row: (
      <TallyRow
        option={{ id: "1", label: "Poo Poo Point", proposer: "Bo", votes: 0 }}
        voterCount={0}
      />
    ),
  },
  {
    state: "Open, one vote, the viewer's",
    row: (
      <TallyRow
        option={{
          id: "1",
          label: "Lake 22",
          details: "Old-growth forest to a lake under Mount Pilchuck.",
          proposer: "kestrel_hikes",
          votes: 1,
          yourVote: true,
        }}
        voterCount={1}
      />
    ),
  },
  {
    state: "Longest name and details, proposed by the bot",
    row: (
      <TallyRow
        option={{
          id: "1",
          label: LONGEST_LOCATION,
          details: LONGEST_DETAILS,
          proposer: "hikebot",
          votes: 7,
        }}
        voterCount={12}
      />
    ),
  },
  {
    state: "Closed: the winner, and the viewer's vote",
    row: (
      <TallyRow
        option={{
          id: "1",
          label: "Mailbox Peak",
          details: "Old trail up, new trail down. 9.4 miles, 4,000 feet.",
          proposer: "Ana",
          votes: 11,
          yourVote: true,
        }}
        voterCount={14}
        winner
      />
    ),
  },
  {
    state: "Closed: the winner drawn from a tie",
    row: (
      <TallyRow
        option={{ id: "1", label: "Mount Si", proposer: "Ana", votes: 4 }}
        voterCount={9}
        winner
        tiedOptions={3}
      />
    ),
  },
  {
    state: "Closed: a date, drawn from a tie at no votes",
    row: (
      <TallyRow
        option={{ id: "1", label: "Sat, 5 Dec 2026 · 11:00", votes: 0 }}
        voterCount={0}
        winner
        tiedOptions={4}
      />
    ),
  },
  {
    state: "Details folded, in a long list",
    row: (
      <TallyRow
        option={{
          id: "1",
          label: "Wallace Falls",
          details: "Nine falls, 5.6 miles.",
          proposer: "Ines",
          votes: 4,
        }}
        voterCount={14}
        collapseDetails
      />
    ),
  },
];

function TallyRowSection() {
  return (
    <Section
      id="tally-row"
      title="Tally row"
      intro="One option of a vote: its label, its votes as a number and as a bar of the members who voted, the winner, the viewer's vote, the details and who proposed it."
    >
      <ul class="stack stack--loose list-reset">
        {EXAMPLES.map(({ state, row }) => (
          <li key={state} class="stack stack--tight">
            <h3 class="u-small u-muted">{state}</h3>
            {row}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export const tallyRowSection: StyleguideSection = {
  id: "tally-row",
  title: "Tally row",
  render: TallyRowSection,
  ownPage: true,
};
