/** Style guide: every icon, at both sizes. */
import { ICONS } from "../../components/icons";
import { Section, type StyleguideSection } from "./section";

function IconsSection() {
  return (
    <Section
      id="icons"
      title="Icons"
      intro="Stroke icons on a 24-unit grid from Lucide, drawn in the colour of the text beside them. An icon goes with words; on its own it needs a label."
    >
      <ul class="styleguide-icons">
        {Object.entries(ICONS).map(([name, Glyph]) => (
          <li key={name}>
            <Glyph />
            <Glyph size="small" />
            {name.replace(/Icon$/, "")}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export const iconsSection: StyleguideSection = {
  id: "icons",
  title: "Icons",
  render: IconsSection,
};
