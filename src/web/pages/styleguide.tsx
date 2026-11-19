/**
 * The style guide at `/styleguide`: every Cairn token and every component
 * in every state, drawn with the real stylesheet. It is the design
 * system's visual reference and, through its screenshots, its regression
 * surface. Each section is a file under `styleguide/`; "Add a component to
 * the design system" in src/web/AGENTS.md says how to add one.
 */
import { Layout } from "../layout";
import type { SchemeTokens } from "../tokens";
import { appHeaderSection } from "./styleguide/app-header";
import { avatarSection } from "./styleguide/avatar";
import { bannerSection } from "./styleguide/banner";
import { blazeSection } from "./styleguide/blaze";
import { buttonSection } from "./styleguide/button";
import { cardSection } from "./styleguide/card";
import { colourSection } from "./styleguide/colour";
import { contrastSection } from "./styleguide/contrast";
import { discordSignInSection } from "./styleguide/discord-sign-in";
import { emptyStateSection } from "./styleguide/empty-state";
import { hikeCardSection } from "./styleguide/hike-card";
import { iconsSection } from "./styleguide/icons";
import { layoutMotionSection } from "./styleguide/layout-motion";
import { mapSection } from "./styleguide/map";
import { roundStepperSection } from "./styleguide/round-stepper";
import type { StyleguideSection } from "./styleguide/section";
import { serverTileSection } from "./styleguide/server-tile";
import { shapeSection } from "./styleguide/shape";
import { spaceSection } from "./styleguide/space";
import { statusPillSection } from "./styleguide/status-pill";
import { tallyListSection } from "./styleguide/tally-list";
import { tallyRowSection } from "./styleguide/tally-row";
import { tallyVoteSection } from "./styleguide/tally-vote";
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
  appHeaderSection,
  avatarSection,
  bannerSection,
  blazeSection,
  buttonSection,
  cardSection,
  discordSignInSection,
  emptyStateSection,
  hikeCardSection,
  iconsSection,
  roundStepperSection,
  serverTileSection,
  statusPillSection,
  tallyListSection,
  tallyRowSection,
  tallyVoteSection,
];

/** The map picture's style. */
const MAP: StyleguideSection[] = [mapSection];

/** Every section, in the order the index lists them. */
export const STYLEGUIDE_SECTIONS = [...FOUNDATIONS, ...COMPONENTS, ...MAP];

/** Where a section is shown: on the style guide, or on a page of its own. */
export function sectionHref({ id, ownPage }: StyleguideSection): string {
  return ownPage ? `/styleguide/${id}` : `#${id}`;
}

/** The section shown on its own at `/styleguide/<id>`, if there is one. */
export function ownPageSection(id: string): StyleguideSection | undefined {
  return STYLEGUIDE_SECTIONS.find(
    (section) => section.ownPage && section.id === id,
  );
}

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
        {sections.map((section) => (
          <li key={section.id}>
            <a href={sectionHref(section)}>{section.title}</a>
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
          <h2>Contents</h2>
          <Index title="Foundations" sections={FOUNDATIONS} />
          <Index title="Components" sections={COMPONENTS} />
          <Index title="Map picture" sections={MAP} />
        </nav>
        {STYLEGUIDE_SECTIONS.filter(({ ownPage }) => !ownPage).map(
          ({ id, render: Render }) => (
            <Render key={id} tokens={tokens} />
          ),
        )}
      </div>
    </Layout>
  );
}

/** A section too tall for the style guide, on its own page. */
export function StyleguideSectionPage({
  section,
  tokens,
}: {
  section: StyleguideSection;
  tokens: SchemeTokens;
}) {
  const { title, render: Render } = section;
  return (
    <Layout title={`${title} · Style guide · hikebot`} width="overview">
      <div class="stack stack--section">
        <div class="page-heading">
          <p class="page-heading__eyebrow">Cairn design system</p>
          <h1>Style guide</h1>
          <p class="page-heading__lead">
            {title}, on a page of its own, in every state.
          </p>
        </div>
        <Render tokens={tokens} />
      </div>
    </Layout>
  );
}
