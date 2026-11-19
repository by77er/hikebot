/** Style guide: Status pill in each status, alone and beside a heading. */
import {
  STATUSES,
  StatusPill,
  type Status,
} from "../../components/status-pill";
import { Section, StateList, type StyleguideSection } from "./section";

const MEANS: Record<Status, string> = {
  open: "A vote is running",
  closed: "A vote has ended",
  decided: "The location or date is decided",
  planned: "The hike is planned",
  cancelled: "The round was cancelled",
};

function StatusPillSection() {
  return (
    <Section
      id="status-pill"
      title="Status pill"
      intro="The state of a vote, a round or a hike in the bot's word, with an icon. The word and the icon's shape carry the state; the colour repeats it."
    >
      <StateList
        examples={STATUSES.map((status) => ({
          state: MEANS[status],
          example: <StatusPill status={status} />,
        }))}
      />
      <h3>Beside a heading</h3>
      <div class="stack">
        <div class="cluster">
          <h4>Where should we hike?</h4>
          <StatusPill status="open" />
        </div>
        <div class="cluster">
          <h4>When should we hike Mailbox Peak?</h4>
          <StatusPill status="closed" />
        </div>
      </div>
    </Section>
  );
}

export const statusPillSection: StyleguideSection = {
  id: "status-pill",
  title: "Status pill",
  render: StatusPillSection,
  ownPage: true,
};
