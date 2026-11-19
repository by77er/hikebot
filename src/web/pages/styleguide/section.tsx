/**
 * The parts every style guide section shares: its props, the section frame
 * with its heading and anchor, and the list that shows one component in
 * each of its states.
 */
import type { ComponentChildren } from "preact";
import type { SchemeTokens } from "../../tokens";

export interface SectionProps {
  /** Token values from the stylesheet, for both colour schemes. */
  tokens: SchemeTokens;
}

export interface StyleguideSection {
  /** The anchor: lower-case words joined by hyphens. */
  id: string;
  title: string;
  render: (props: SectionProps) => preact.JSX.Element;
  /**
   * Shown on a page of its own at `/styleguide/<id>` rather than on the
   * style guide, for a section too tall for the style guide's screenshot.
   */
  ownPage?: boolean;
}

export function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <section class="styleguide-section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p>{intro}</p>
      {children}
    </section>
  );
}

/** One example per state, each with its state's name under it. */
export function StateList({
  examples,
}: {
  examples: { state: string; example: ComponentChildren }[];
}) {
  return (
    <ul class="styleguide-states">
      {examples.map(({ state, example }) => (
        <li key={state}>
          {example}
          <span class="styleguide-states__label">{state}</span>
        </li>
      ))}
    </ul>
  );
}
