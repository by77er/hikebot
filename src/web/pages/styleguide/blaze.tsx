/** Style guide: the trail blaze. */
import { Blaze } from "../../components/blaze";
import { Section, type StyleguideSection } from "./section";

function BlazeSection() {
  return (
    <Section
      id="blaze"
      title="Blaze"
      intro="The painted mark on a tree that shows the trail. It is the brand mark and marks “you are here” and the winner, always next to words that say the same."
    >
      <ul class="cluster">
        <li class="cluster">
          <Blaze /> hikebot
        </li>
        <li class="cluster">
          <Blaze label="Winner" /> Mailbox Peak, 11 votes
        </li>
      </ul>
    </Section>
  );
}

export const blazeSection: StyleguideSection = {
  id: "blaze",
  title: "Blaze",
  render: BlazeSection,
};
