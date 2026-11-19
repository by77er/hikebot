/**
 * Sign in with Discord: the primary button that starts signing in, a link
 * to `/login` (with `next` when given) carrying Discord's mark before the
 * label. It is a variant of Button: the same shape and states as the
 * primary button, with the mark drawn in white or black as Discord's brand
 * guidelines allow (https://discord.com/branding). Use it once per page,
 * as that page's primary action.
 */
import { Button, type Preview } from "./button";
import type { IconProps } from "./icon";
import { DiscordIcon } from "./icons";

/** Discord's mark, in the colour its brand guidelines allow on the fill. */
function Mark({ class: extra, ...props }: IconProps) {
  return (
    <DiscordIcon
      {...props}
      class={[extra, "discord-sign-in__mark"].filter(Boolean).join(" ")}
    />
  );
}

export interface DiscordSignInProps {
  /** Where to land after signing in, a path on this site. */
  next?: string;
  /** The label; defaults to "Sign in with Discord". */
  children?: string;
  /** Fills the width of its container. */
  block?: boolean;
  preview?: Preview;
}

export function DiscordSignIn({
  next,
  children = "Sign in with Discord",
  block,
  preview,
}: DiscordSignInProps) {
  const href =
    next === undefined ? "/login" : `/login?next=${encodeURIComponent(next)}`;
  return (
    <Button
      variant="primary"
      href={href}
      icon={Mark}
      block={block}
      preview={preview}
    >
      {children}
    </Button>
  );
}
