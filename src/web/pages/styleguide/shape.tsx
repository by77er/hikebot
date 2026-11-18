/** Style guide: radius, borders and the one elevation. */
import { Section, type SectionProps, type StyleguideSection } from "./section";

const RADII = [
  { name: "control", use: "Buttons, inputs, banners" },
  { name: "card", use: "Cards" },
  { name: "pill", use: "Status pills, counts" },
  { name: "blaze", use: "The blaze, code" },
];

function Shape({ tokens }: SectionProps) {
  const values = tokens.light;
  return (
    <Section
      id="shape"
      title="Radius, borders and elevation"
      intro="Soft corners, thin borders, and a shadow only on things that float over the page."
    >
      <ul class="styleguide-shapes">
        {RADII.map(({ name, use }) => (
          <li key={name}>
            <span class="styleguide-shape" data-radius={name}>
              --radius-{name}: {values[`radius-${name}`]}. {use}
            </span>
          </li>
        ))}
        <li>
          <span class="styleguide-shape" data-elevation="overlay">
            --elevation-overlay. Menus and dialogs only
          </span>
        </li>
      </ul>
      <p>
        Borders are <code>--border-width</code> ({values["border-width"]}) for
        dividers and <code>--border-width-strong</code> (
        {values["border-width-strong"]}) for control boundaries; the focus ring
        is <code>--focus-width</code> ({values["focus-width"]}) with a{" "}
        {values["focus-offset"]} gap.
      </p>
    </Section>
  );
}

export const shapeSection: StyleguideSection = {
  id: "shape",
  title: "Radius, borders and elevation",
  render: Shape,
};
