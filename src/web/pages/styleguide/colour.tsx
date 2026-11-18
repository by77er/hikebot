/** Style guide: every colour token, its value in each scheme. */
import { colourTokens } from "../../tokens";
import { Section, type SectionProps, type StyleguideSection } from "./section";

function Colour({ tokens }: SectionProps) {
  return (
    <Section
      id="colour"
      title="Colour"
      intro="Roles, not raw colours: components name the role they need. The swatch shows the scheme you are viewing in; the values are light, then dark."
    >
      <ul class="styleguide-swatches">
        {colourTokens(tokens.light).map(([name, light]) => (
          <li key={name} class="styleguide-swatch">
            <span class="styleguide-sample" data-bg={name} />
            <code>--{name}</code>
            <span class="u-muted u-numeric">
              {light} · {tokens.dark[name]}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export const colourSection: StyleguideSection = {
  id: "colour",
  title: "Colour",
  render: Colour,
};
