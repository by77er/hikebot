/** Style guide: Empty state, with and without an action. */
import { Button } from "../../components/button";
import { EmptyState } from "../../components/empty-state";
import { MapPinIcon } from "../../components/icons";
import { Section, type StyleguideSection } from "./section";

function EmptyStateSection() {
  return (
    <Section
      id="empty-state"
      title="Empty state"
      intro="What a page or section shows when it has nothing yet: a heading, one sentence on what happens next in the bot's words, and at most one action. It sits on the contour lines."
    >
      <h3>Without an action</h3>
      <EmptyState title="No hikes yet" headingLevel={4}>
        The first one appears here when a date vote closes.
      </EmptyState>
      <h3>With an action</h3>
      <EmptyState
        title="No locations yet"
        headingLevel={4}
        action={
          <Button
            variant="primary"
            icon={MapPinIcon}
            href="/styleguide/empty-state"
          >
            Propose a location
          </Button>
        }
      >
        There are no locations to vote for yet. Propose one first.
      </EmptyState>
      <h3>No vote open</h3>
      <EmptyState title="No vote is open" headingLevel={4}>
        A round starts when an organiser starts a location vote in Discord.
      </EmptyState>
    </Section>
  );
}

export const emptyStateSection: StyleguideSection = {
  id: "empty-state",
  title: "Empty state",
  render: EmptyStateSection,
  ownPage: true,
};
