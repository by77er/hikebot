/**
 * The style guide at `/styleguide`: every Cairn token and every component
 * in every state, drawn with the real stylesheet. It is the design
 * system's visual reference and, through its screenshots, its regression
 * surface. Each section is a file under `styleguide/`; "Add a component to
 * the design system" in src/web/AGENTS.md says how to add one.
 */
import { Layout } from "../layout";
import type { SchemeTokens } from "../tokens";
import { bannerSection } from "./styleguide/banner";
import { blazeSection } from "./styleguide/blaze";
import { buttonSection } from "./styleguide/button";
import { cardSection } from "./styleguide/card";
import { colourSection } from "./styleguide/colour";
import { contrastSection } from "./styleguide/contrast";
import { iconsSection } from "./styleguide/icons";
import { layoutMotionSection } from "./styleguide/layout-motion";
import type { StyleguideSection } from "./styleguide/section";
import { shapeSection } from "./styleguide/shape";
import { spaceSection } from "./styleguide/space";
import { typographySection } from "./styleguide/typography";

/** The tokens, in the order docs/design-system.md gives them. */
const FOUNDATIONS: StyleguideSection[] = [
  colourSection,
  contrastSection,
  typographySection,
  spaceSection,
  shapeSection,
  layoutMotionSection,
];

/** The components, in alphabetical order, one per line. */
const COMPONENTS: StyleguideSection[] = [
  bannerSection,
  blazeSection,
  buttonSection,
  cardSection,
  iconsSection,
];

/** Every section, in the order the page shows them. */
export const STYLEGUIDE_SECTIONS = [...FOUNDATIONS, ...COMPONENTS];

function Index({
  title,
  sections,
}: {
  title: string;
  sections: StyleguideSection[];
}) {
  return (
    <div class="stack stack--tight">
      <h3>{title}</h3>
      <ol>
        {sections.map(({ id, title: name }) => (
          <li key={id}>
            <a href={`#${id}`}>{name}</a>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function StyleguidePage({ tokens }: { tokens: SchemeTokens }) {
  return (
    <Layout title="Style guide · hikebot" width="overview">
      <div class="stack stack--section">
        <div class="page-heading">
          <p class="page-heading__eyebrow">Cairn design system</p>
          <h1>Style guide</h1>
          <p class="page-heading__lead">
            Every token and every component of hikebot's web pages, in every
            state. Change the colour scheme of your device to see the other one.
          </p>
        </div>
        <nav class="styleguide-index stack" aria-label="Style guide">
          <h2>On this page</h2>
          <Index title="Foundations" sections={FOUNDATIONS} />
          <Index title="Components" sections={COMPONENTS} />
        </nav>
        {STYLEGUIDE_SECTIONS.map(({ id, render: Render }) => (
          <Render key={id} tokens={tokens} />
        ))}
      </div>
    </Layout>
  );
}
