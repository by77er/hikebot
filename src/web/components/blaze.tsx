/**
 * Blaze: the painted rectangle that marks a trail, in trail-blaze orange.
 * It is the brand mark, and it marks "you are here" and the winner. It is
 * decorative unless given a `label` (such as "Winner"), which becomes its
 * accessible name; the text next to it must still say the same in words.
 */

export interface BlazeProps {
  label?: string;
}

export function Blaze({ label }: BlazeProps) {
  return label ? (
    <span class="blaze" role="img" aria-label={label} />
  ) : (
    <span class="blaze" aria-hidden="true" />
  );
}
