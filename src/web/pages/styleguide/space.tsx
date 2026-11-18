/** Style guide: the spacing scale. */
import { Section, type SectionProps, type StyleguideSection } from "./section";

const STEPS = ["1", "2", "3", "4", "5", "6", "7", "8"];

function Space({ tokens }: SectionProps) {
  return (
    <Section
      id="space"
      title="Space"
      intro="Eight steps on a 4px base. Related things sit close; groups are separated by the next step up."
    >
      <ul class="styleguide-scale">
        {STEPS.map((step) => (
          <li key={step}>
            <span>
              --space-{step}: {tokens.light[`space-${step}`]}
            </span>
            <span class="styleguide-bar" data-space={step} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

export const spaceSection: StyleguideSection = {
  id: "space",
  title: "Space",
  render: Space,
};
