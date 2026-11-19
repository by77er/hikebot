/**
 * Back link: the way up to the page this one belongs to, such as from a
 * setting to the settings, at the top of the page above its heading. Its
 * words say where it goes ("Back to settings"), since a member may have
 * come from anywhere; it is a plain link, so it works without JavaScript
 * and never depends on the browser's history. For the way back at the
 * foot of a form, use a Button in the form actions instead.
 */
import type { ComponentChildren } from "preact";
import type { Preview } from "./button";
import { ArrowLeftIcon } from "./icons";

export function BackLink({
  href,
  children,
  preview,
}: {
  href: string;
  /** Where it goes: "Back to settings". */
  children: ComponentChildren;
  preview?: Preview;
}) {
  return (
    <a class="back-link" href={href} data-preview={preview}>
      <ArrowLeftIcon class="back-link__icon" />
      <span>{children}</span>
    </a>
  );
}
