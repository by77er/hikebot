/**
 * Confirmation: the page between a member's click and an action that
 * cannot be undone, such as closing a vote or cancelling a round. It is a
 * whole page, never a dialog: the click is a link to it, so it works
 * without JavaScript, can be reached and left with the browser's own
 * back, and nothing happens until its form is posted. It asks the
 * question as the bot does ("Cancel this round?"), restates what will
 * happen in the bot's words, says that it cannot be undone, and offers the
 * action (`danger` where it destroys something, `primary` otherwise) with
 * a way back next to it. Render it as the only content of the page, with
 * the CSRF field and what identifies the thing in `fields`.
 */
import type { ComponentChildren } from "preact";
import { Button } from "./button";
import { FormActions } from "./form-actions";
import type { IconComponent } from "./icon";
import { TriangleAlertIcon } from "./icons";

export interface ConfirmationProps {
  /** What it is about, above the question: "Location vote". */
  eyebrow?: ComponentChildren;
  /** The question, in the bot's words: "Cancel this round?" */
  title: ComponentChildren;
  /** 1 on its own page (the default); lower only on the style guide. */
  headingLevel?: 1 | 2 | 3;
  /** What will happen, in the bot's words, and what it applies to. */
  children: ComponentChildren;
  /** Where the form posts. */
  formAction: string;
  /** Hidden fields: the CSRF token and what identifies the thing. */
  fields?: ComponentChildren;
  /** The button that does it, named as the bot names it. */
  action: {
    label: string;
    /** `danger` where it destroys or cancels something. */
    variant: "primary" | "danger";
    icon?: IconComponent;
  };
  /** The way back without doing it: the page the member came from. */
  back: { href: string; label: string };
}

export function Confirmation({
  eyebrow,
  title,
  headingLevel = 1,
  children,
  formAction,
  fields,
  action,
  back,
}: ConfirmationProps) {
  const Heading = (["h1", "h2", "h3"] as const)[headingLevel - 1] ?? "h1";
  return (
    <div class="confirmation">
      <div class="page-heading">
        {eyebrow !== undefined && (
          <p class="page-heading__eyebrow">{eyebrow}</p>
        )}
        <Heading class="confirmation__title">{title}</Heading>
      </div>
      <div class="confirmation__body">{children}</div>
      <p class="confirmation__warning">
        <TriangleAlertIcon class="confirmation__warning-icon" />
        This cannot be undone.
      </p>
      <form class="confirmation__form" method="post" action={formAction}>
        {fields}
        <FormActions>
          <Button variant={action.variant} icon={action.icon}>
            {action.label}
          </Button>
          <Button variant="secondary" href={back.href}>
            {back.label}
          </Button>
        </FormActions>
      </form>
    </div>
  );
}
