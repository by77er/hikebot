/**
 * Card: one thing (a hike, a location, a setting) on a surface of its own,
 * with a heading that names it. Given `href`, the heading's link covers
 * the whole card, so the card can be tapped anywhere; controls in its
 * footer stay separately clickable. The heading is the card's accessible
 * name; pick its level to follow the page's outline.
 */
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import type { Preview } from "./button";

export interface CardProps {
  title: ComponentChildren;
  /** Defaults to 2, a card directly under the page's h1. */
  headingLevel?: 2 | 3 | 4;
  /** Makes the whole card a link to this path. */
  href?: string;
  /** Details, such as the date or who proposed it. */
  children?: ComponentChildren;
  /** A row at the foot: a status, a count, a small action. */
  footer?: ComponentChildren;
  preview?: Preview;
}

export function Card({
  title,
  headingLevel = 2,
  href,
  children,
  footer,
  preview,
}: CardProps) {
  const titleId = useId();
  const Heading = (["h2", "h3", "h4"] as const)[headingLevel - 2] ?? "h2";
  const linked = href !== undefined;
  return (
    <article
      class={linked ? "card card--link" : "card"}
      aria-labelledby={titleId}
      data-preview={linked && preview !== "focus" ? preview : undefined}
    >
      <Heading class="card__title" id={titleId}>
        {linked ? (
          <a
            class="card__link"
            href={href}
            data-preview={preview === "focus" ? preview : undefined}
          >
            {title}
          </a>
        ) : (
          title
        )}
      </Heading>
      {children !== undefined && <div class="card__body">{children}</div>}
      {footer !== undefined && <div class="card__footer">{footer}</div>}
    </article>
  );
}
