/** Style guide: Card, plain and as a link, in each state. */
import { Card } from "../../components/card";
import { CalendarIcon, UsersIcon } from "../../components/icons";
import type { Preview } from "../../components/button";
import { Section, StateList, type StyleguideSection } from "./section";

const STATES: { state: string; preview?: Preview }[] = [
  { state: "Default" },
  { state: "Hover", preview: "hover" },
  { state: "Focus visible", preview: "focus" },
  { state: "Active", preview: "active" },
];

function CardSection() {
  return (
    <Section
      id="card"
      title="Card"
      intro="One thing on a surface of its own, named by its heading. A card with a link can be tapped anywhere."
    >
      <div class="grid">
        <Card
          title="Mailbox Peak"
          headingLevel={3}
          footer={
            <span class="cluster">
              <UsersIcon size="small" /> 11 votes
            </span>
          }
        >
          <p>Steep, 9.4 miles round trip, 4,000 feet of gain.</p>
        </Card>
        <Card
          title="A very long location name that goes on to show how a card title wraps over several lines on a phone"
          headingLevel={3}
        >
          <p>Proposed by a member.</p>
        </Card>
      </div>
      <h3>As a link</h3>
      <StateList
        examples={STATES.map(({ state, preview }) => ({
          state,
          example: (
            <Card
              title="Saturday hike"
              headingLevel={4}
              href="/styleguide#card"
              preview={preview}
              footer={
                <span class="cluster">
                  <CalendarIcon size="small" /> 2031-06-14
                </span>
              }
            >
              <p>Location vote open</p>
            </Card>
          ),
        }))}
      />
    </Section>
  );
}

export const cardSection: StyleguideSection = {
  id: "card",
  title: "Card",
  render: CardSection,
};
