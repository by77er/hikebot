/**
 * Error summary: the box at the top of a form that comes back with
 * errors. Its title says what did not happen, in the bot's words ("The
 * date vote was not started."); under it, a link to each field in error,
 * with the same words as the error next to the field. The page puts it
 * first in `main`, above the heading, and starts its `<title>` with
 * "Error:" so the problem is the first thing read. It takes focus when the
 * page loads (`autofocus`, which needs no JavaScript) and is an alert, so
 * assistive technology announces it; each link moves focus to its field.
 * Its title is a paragraph, not a heading, so the page's h1 still comes
 * first in the outline.
 */
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { CircleXIcon } from "./icons";

export interface FieldErrorLink {
  /** The id of the field in error, or of a group's first choice. */
  field: string;
  /** The error, as the field shows it. */
  message: ComponentChildren;
}

export interface ErrorSummaryProps {
  /** What did not happen, such as "Your location was not added." */
  title: ComponentChildren;
  errors: FieldErrorLink[];
  /** Defaults to true; off only where several are shown, as on the style guide. */
  autoFocus?: boolean;
}

export function ErrorSummary({
  title,
  errors,
  autoFocus = true,
}: ErrorSummaryProps) {
  const titleId = useId();
  return (
    <div
      class="error-summary"
      role="alert"
      aria-labelledby={titleId}
      tabindex={-1}
      autofocus={autoFocus}
    >
      <CircleXIcon class="error-summary__icon" label="Error" />
      <div class="error-summary__body">
        <p class="error-summary__title" id={titleId}>
          {title}
        </p>
        <ul class="error-summary__list">
          {errors.map(({ field, message }) => (
            <li key={field}>
              <a href={`#${field}`}>{message}</a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
