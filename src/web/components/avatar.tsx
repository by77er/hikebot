/**
 * Avatar: a picture of a Discord user (round) or server (rounded square),
 * with the name's initials drawn behind it on a token colour. The initials
 * show when there is no picture, and also when the picture fails to load,
 * without any script: a picture that loads covers them, and one that fails
 * draws them again over the browser's broken-image mark. Decorative by
 * default, because a name stands next to it; give `label` only where no
 * name is beside it. The picture is asked for without a referrer, so
 * Discord's CDN is not told which page showed it.
 */

export type AvatarSize = "default" | "small";
export type AvatarShape = "round" | "square";

const DISCORD_CDN = "https://cdn.discordapp.com";

/** Pixels the picture is fetched at: twice its size, for sharp screens. */
const FETCH_SIZE: Record<AvatarSize, number> = { default: 128, small: 64 };

/**
 * The address of a user's avatar, or null without one. `hash` is the avatar
 * hash Discord gives (`Session.avatar`).
 */
export function userAvatarUrl(
  userId: string,
  hash: string | null,
  size: AvatarSize = "default",
): string | null {
  return hash === null
    ? null
    : `${DISCORD_CDN}/avatars/${userId}/${hash}.png?size=${String(FETCH_SIZE[size])}`;
}

/** The address of a server's icon, or null without one. */
export function serverIconUrl(
  guildId: string,
  hash: string | null,
  size: AvatarSize = "default",
): string | null {
  return hash === null
    ? null
    : `${DISCORD_CDN}/icons/${guildId}/${hash}.png?size=${String(FETCH_SIZE[size])}`;
}

/**
 * The first letter of each of the first `count` words of `name`, in capitals,
 * as Discord shows a server without an icon; `?` for a name with no letters.
 */
export function initials(name: string, count: number): string {
  const letters = name
    .split(/\s+/)
    .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? "")
    .filter((letter) => letter !== "")
    .slice(0, count)
    .join("");
  return letters === "" ? "?" : letters.toLocaleUpperCase("en");
}

export interface AvatarProps {
  /** The user's or server's name, for the initials. */
  name: string;
  /** The picture's address (`userAvatarUrl`, `serverIconUrl`), or null. */
  src: string | null;
  /** 48px (the default), or 32px for the header. */
  size?: AvatarSize;
  /** Round for a person (the default), a rounded square for a server. */
  shape?: AvatarShape;
  /** The accessible name, only where no name is shown next to it. */
  label?: string;
  /** Extra classes, such as the part of a component it sits in. */
  class?: string;
}

export function Avatar({
  name,
  src,
  size = "default",
  shape = "round",
  label,
  class: extra,
}: AvatarProps) {
  const className = [
    "avatar",
    size === "small" && "avatar--small",
    shape === "square" && "avatar--square",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
  const named = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": "true" as const };
  const letters = initials(name, shape === "square" ? 2 : 1);
  return (
    <span class={className} {...named}>
      <span class="avatar__initials">{letters}</span>
      {src !== null && (
        <img
          class="avatar__image"
          data-initials={letters}
          src={src}
          alt=""
          width={size === "small" ? 32 : 48}
          height={size === "small" ? 32 : 48}
          decoding="async"
          referrerpolicy="no-referrer"
        />
      )}
    </span>
  );
}
