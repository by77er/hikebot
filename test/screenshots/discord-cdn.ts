/**
 * Stands in for Discord's CDN (`https://cdn.discordapp.com`) while the
 * screenshots are taken, so avatars and server icons render the same on
 * every run without the network. A seed names a picture by its hash:
 *
 * - `picture-<n>` (n from 1): a fixed picture, a mountain on a coloured
 *   ground, colours chosen by n;
 * - `missing`: answers 404, as Discord does for a deleted picture, to show
 *   the initials a failed picture leaves; this is the only failed request
 *   the screenshot script accepts.
 *
 * Any other address on the CDN answers 404 too and fails the run.
 */

export const CDN_ORIGIN = "https://cdn.discordapp.com";

/** The hash a seed gives for a picture that fails to load. */
export const MISSING_PICTURE = "missing";

/** A seed's hash for picture n. */
export function picture(n: number): string {
  return `picture-${String(n)}`;
}

const GROUNDS = [
  ["#2f6f8f", "#e8f1f5"],
  ["#7a4f9a", "#f3ecf8"],
  ["#b5562c", "#fbeee6"],
  ["#3d7a3a", "#eaf4e8"],
  ["#8a6a1f", "#f7f0de"],
] as const;

function svg(n: number): string {
  const [ground, peak] = GROUNDS[(n - 1) % GROUNDS.length] ?? GROUNDS[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><rect width="128" height="128" fill="${ground}"/><circle cx="92" cy="36" r="12" fill="${peak}" opacity="0.8"/><path d="M8 108 52 44l22 32 12-14 34 46Z" fill="${peak}"/></svg>`;
}

export interface CdnReply {
  status: number;
  contentType: string;
  body: string;
}

/** Whether the address is one the screenshot script lets fail on purpose. */
export function isMissingPicture(url: string): boolean {
  return (
    url.startsWith(`${CDN_ORIGIN}/`) &&
    new URL(url).pathname.endsWith(`/${MISSING_PICTURE}.png`)
  );
}

/** The CDN's answer to `url`, or null for an address not on the CDN. */
export function cdnReply(url: string): CdnReply | null {
  if (!url.startsWith(`${CDN_ORIGIN}/`)) return null;
  const match = /\/picture-(\d+)\.png$/.exec(new URL(url).pathname);
  const n = Number(match?.[1] ?? 0);
  if (n < 1) {
    return { status: 404, contentType: "text/plain", body: "404: Not Found" };
  }
  return { status: 200, contentType: "image/svg+xml", body: svg(n) };
}
