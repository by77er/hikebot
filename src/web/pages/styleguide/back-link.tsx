/** Style guide: Back link in every state, with a long destination. */
import { BackLink } from "../../components/back-link";
import type { Preview } from "../../components/button";
import { Section, StateList, type StyleguideSection } from "./section";

const STATES: { state: string; preview?: Preview }[] = [
  { state: "Default" },
  { state: "Hover", preview: "hover" },
  { state: "Focus visible", preview: "focus" },
  { state: "Active", preview: "active" },
];

function BackLinkSection() {
  return (
    <Section
      id="back-link"
      title="Back link"
      intro="The way up to the page this one belongs to, above the page's heading. Its words say where it goes."
    >
      <StateList
        examples={STATES.map(({ state, preview }) => ({
          state,
          example: (
            <BackLink href="/styleguide" preview={preview}>
              Back to settings
            </BackLink>
          ),
        }))}
      />
      <h3>A long destination wraps</h3>
      <BackLink href="/styleguide">
        Back to Weekend Warriors of the Cascades, Olympics and North Cascades
        Hiking and Snowshoe Club
      </BackLink>
    </Section>
  );
}

export const backLinkSection: StyleguideSection = {
  id: "back-link",
  title: "Back link",
  render: BackLinkSection,
  ownPage: true,
};
