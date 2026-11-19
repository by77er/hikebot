/**
 * Form actions: the bar at the foot of a form with its one primary action
 * first and a way back after it, such as "Propose a location" and "Back".
 * On a phone the buttons stack and fill the width, the primary on top
 * where the thumb finds it; from the breakpoint they sit in a row,
 * primary first. Put the submit button (a Button, which submits by
 * default) and a Button link or quiet button for the way back in it;
 * never a reset button.
 */
import type { ComponentChildren } from "preact";

export function FormActions({ children }: { children: ComponentChildren }) {
  return <div class="form-actions">{children}</div>;
}
