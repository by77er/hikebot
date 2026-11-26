/**
 * The one-time banner a server's page shows after a member's action
 * succeeded ("Your votes are saved.", "Added Lake."). The action answers
 * with a redirect back to the page (post, redirect, get) and sets the
 * banner in a short-lived cookie, sealed with `SIGNING_SECRET` (purpose
 * `flash`) for the user and the server; the page shows it once and clears
 * the cookie in the same answer, so a reload shows the page without it and
 * repeats nothing.
 */
import { open, seal } from "../signing";
import { clearCookie, readCookie, setCookie } from "./auth/cookies";
import type { Session } from "./auth/session";

export const FLASH_COOKIE = "__Host-hikebot_flash";
/** Long enough for the redirect to be followed, and no longer. */
export const FLASH_TTL_MS = 60_000;

/** What the banner says. */
export interface Flash {
  banner: string;
  /** A second sentence under the banner, or null. */
  note: string | null;
}

interface FlashPayload {
  u: string;
  g: string;
  b: string;
  n: string | null;
}

/** The `Set-Cookie` value that carries `flash` to the next page of `guildId`. */
export async function flashCookie(
  env: { SIGNING_SECRET: string },
  session: Session,
  guildId: string,
  flash: Flash,
  now: number,
): Promise<string> {
  const payload: FlashPayload = {
    u: session.userId,
    g: guildId,
    b: flash.banner,
    n: flash.note,
  };
  const value = await seal(
    env.SIGNING_SECRET,
    "flash",
    payload,
    now + FLASH_TTL_MS,
  );
  return setCookie(FLASH_COOKIE, value, FLASH_TTL_MS / 1000);
}

/**
 * The banner the request carries for the session's user on `guildId`'s
 * page, and the headers that clear its cookie. A cookie for another
 * server is left for that server's page; one that is expired, tampered
 * with or for another user is cleared and shows nothing.
 */
export async function takeFlash(
  request: Request,
  env: { SIGNING_SECRET: string },
  session: Session,
  guildId: string,
  now: number,
): Promise<{ flash: Flash | null; headers: [string, string][] }> {
  const value = readCookie(request, FLASH_COOKIE);
  if (value === null) return { flash: null, headers: [] };
  const payload = await open<FlashPayload>(
    env.SIGNING_SECRET,
    "flash",
    value,
    now,
  );
  const clear: [string, string][] = [["Set-Cookie", clearCookie(FLASH_COOKIE)]];
  if (payload === null || payload.u !== session.userId) {
    return { flash: null, headers: clear };
  }
  if (payload.g !== guildId) return { flash: null, headers: [] };
  return { flash: { banner: payload.b, note: payload.n }, headers: clear };
}
