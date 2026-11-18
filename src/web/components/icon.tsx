/**
 * The frame every Cairn icon is drawn in: a 24-unit grid, a 2-unit round
 * stroke in the surrounding text colour, no fill. An icon is decorative
 * (hidden from assistive technology) unless it gets a `label`, which
 * becomes its accessible name. The icons themselves are in `icons.tsx`.
 */
import type { ComponentChildren } from "preact";

export interface IconProps {
  /** The accessible name; leave it out when text next to it says the same. */
  label?: string;
  /** 20px next to body text (the default), 16px next to small text. */
  size?: "default" | "small";
  /** Extra classes, such as the part of a component it sits in. */
  class?: string;
}

/** An icon component, such as `CheckIcon`. */
export type IconComponent = (props: IconProps) => preact.JSX.Element;

export function Icon({
  label,
  size = "default",
  class: extra,
  children,
}: IconProps & { children: ComponentChildren }) {
  const className = ["icon", size === "small" && "icon--small", extra]
    .filter(Boolean)
    .join(" ");
  const named = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": "true" as const };
  return (
    <svg
      class={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
      {...named}
    >
      {children}
    </svg>
  );
}
