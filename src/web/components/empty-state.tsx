/**
 * Empty state: what a page or a section shows when it has nothing yet (no
 * vote open, no hikes in the log, no options). A heading that says so, one
 * sentence on what happens next, in the bot's words, and optionally the
 * one action that changes it. It sits on the contour-line pattern, one of
 * the two places the motif is used. The heading is its accessible name.
 */
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

export interface EmptyStateProps {
  title: string;
  /** One sentence on what happens next. */
  children: ComponentChildren;
  /** An optional action, usually one `Button`. */
  action?: ComponentChildren;
  /** Defaults to 2; pick it to follow the page's outline. */
  headingLevel?: 2 | 3 | 4;
}

export function EmptyState({
  title,
  children,
  action,
  headingLevel = 2,
}: EmptyStateProps) {
  const titleId = useId();
  const Heading = (["h2", "h3", "h4"] as const)[headingLevel - 2] ?? "h2";
  return (
    <section class="empty-state" aria-labelledby={titleId}>
      <Heading class="empty-state__title" id={titleId}>
        {title}
      </Heading>
      <p class="empty-state__text">{children}</p>
      {action !== undefined && <div class="empty-state__action">{action}</div>}
    </section>
  );
}
