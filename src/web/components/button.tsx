/**
 * Button: an action (a `<button>`, which submits its form by default) or a
 * navigation step that looks like one (an `<a>`, when `href` is given).
 * Variants: `primary` for the one main action of a view, `secondary` for
 * the others, `quiet` for minor ones in a row of controls, `danger` for an
 * action that destroys or cancels something. The label is a verb, in the
 * bot's words ("Vote", "Propose a location", "Cancel round").
 */
import type { ComponentChildren } from "preact";
import type { IconComponent } from "./icon";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

/** Style guide only: shows a state without a pointer or a keyboard. */
export type Preview = "hover" | "active" | "focus";

interface CommonProps {
  /** Defaults to `secondary`. */
  variant?: ButtonVariant;
  /** An icon before the label, from `icons.tsx`. */
  icon?: IconComponent;
  /** An icon after the label, such as `ArrowRightIcon` for "next". */
  iconAfter?: IconComponent;
  /** Fills the width of its container, for a phone's main action. */
  block?: boolean;
  disabled?: boolean;
  preview?: Preview;
  children: ComponentChildren;
}

export interface ButtonAsButtonProps extends CommonProps {
  href?: undefined;
  /** Defaults to `submit`: pages work without JavaScript, through forms. */
  type?: "submit" | "button" | "reset";
  name?: string;
  value?: string;
}

export interface ButtonAsLinkProps extends CommonProps {
  href: string;
}

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

export function Button(props: ButtonProps) {
  const {
    variant = "secondary",
    icon: Before,
    iconAfter: After,
    block,
    disabled,
    preview,
    children,
  } = props;
  const className = ["button", `button--${variant}`, block && "button--block"]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      {Before && <Before class="button__icon" />}
      <span>{children}</span>
      {After && <After class="button__icon" />}
    </>
  );
  if (props.href !== undefined) {
    // A disabled link has no href, so it cannot be followed or focused.
    return disabled ? (
      <a
        class={className}
        role="link"
        aria-disabled="true"
        data-preview={preview}
      >
        {content}
      </a>
    ) : (
      <a class={className} href={props.href} data-preview={preview}>
        {content}
      </a>
    );
  }
  return (
    <button
      class={className}
      type={props.type ?? "submit"}
      name={props.name}
      value={props.value}
      disabled={disabled}
      data-preview={preview}
    >
      {content}
    </button>
  );
}
