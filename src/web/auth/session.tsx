/**
 * The web session: a cookie sealed with `SIGNING_SECRET` (purpose
 * `session`) holding who signed in and which of their Discord servers
 * hikebot is in, as of sign-in. Nothing else is stored: no Discord token,
 * no row in a Durable Object. A tampered, expired or oversized cookie reads
 * as signed out. "Sign-in and sessions" in docs/design.md describes it.
 *
 * The session's server list is a hint for navigation, not a permission:
 * it can be up to seven days old. A page of one server checks membership
 * and roles with the bot's token when it is opened, and every action checks
 * them again.
 */
import { open, seal } from "../../signing";
import { NotFoundPage } from "../pages/errors";
import { seeOther } from "../redirect";
import { htmlResponse } from "../response";
import { clearCookie, readCookie, setCookie } from "./cookies";
import { safeNext } from "./next";

export const SESSION_COOKIE = "__Host-hikebot_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The most servers a session lists. */
export const MAX_SESSION_GUILDS = 25;
/**
 * The most bytes of `name=value` the session cookie may take; browsers keep
 * at least 4096 per cookie. Server names are shortened to stay under it.
 */
export const MAX_SESSION_COOKIE_BYTES = 4000;

export interface SessionGuild {
  id: string;
  name: string;
  /** The icon hash, for `https://cdn.discordapp.com/icons/<id>/<icon>.png`. */
  icon: string | null;
}

export interface Session {
  userId: string;
  /** The user's display name (global name, else username). */
  name: string;
  /** The avatar hash, for `https://cdn.discordapp.com/avatars/<id>/<avatar>.png`. */
  avatar: string | null;
  /** Servers the user shares with hikebot, as of `issuedAt`: a hint only. */
  guilds: SessionGuild[];
  /** When the session started, in milliseconds since the epoch. */
  issuedAt: number;
}

/** The sealed form: short keys, servers as tuples, to keep the cookie small. */
interface SealedSession {
  u: string;
  n: string;
  a: string | null;
  g: [string, string, string | null][];
  t: number;
}

/** Longest server names tried, longest first, until the cookie fits. */
const NAME_LENGTHS = [100, 64, 48, 32, 24, 16, 8, 1];

/**
 * Returns the `Set-Cookie` value that starts `session`, valid for seven days
 * from `session.issuedAt`. Keeps the first MAX_SESSION_GUILDS servers and
 * shortens their names (ending them with `…`) until the cookie is at most
 * MAX_SESSION_COOKIE_BYTES.
 */
export async function sessionCookie(
  env: { SIGNING_SECRET: string },
  session: Session,
): Promise<string> {
  const guilds = session.guilds.slice(0, MAX_SESSION_GUILDS);
  for (const length of NAME_LENGTHS) {
    const sealed: SealedSession = {
      u: session.userId,
      n: shorten(session.name, 64),
      a: session.avatar,
      g: guilds.map((g) => [g.id, shorten(g.name, length), g.icon]),
      t: session.issuedAt,
    };
    const value = await seal(
      env.SIGNING_SECRET,
      "session",
      sealed,
      session.issuedAt + SESSION_TTL_MS,
    );
    if (SESSION_COOKIE.length + 1 + value.length <= MAX_SESSION_COOKIE_BYTES) {
      return setCookie(SESSION_COOKIE, value, SESSION_TTL_MS / 1000);
    }
  }
  throw new Error("the session does not fit in a cookie");
}

/** The `Set-Cookie` value that ends the session. */
export function clearSessionCookie(): string {
  return clearCookie(SESSION_COOKIE);
}

/**
 * Reads the session from the request's cookie at `now` (milliseconds since
 * the epoch). Returns null, meaning signed out, when there is no cookie or it
 * is oversized, tampered with, sealed for another purpose or expired.
 */
export async function readSession(
  request: Request,
  env: { SIGNING_SECRET: string },
  now: number,
): Promise<Session | null> {
  const value = readCookie(request, SESSION_COOKIE);
  if (value === null || value.length > MAX_SESSION_COOKIE_BYTES) return null;
  const sealed = await open<SealedSession>(
    env.SIGNING_SECRET,
    "session",
    value,
    now,
  );
  if (!sealed || !Array.isArray(sealed.g)) return null;
  return {
    userId: sealed.u,
    name: sealed.n,
    avatar: sealed.a,
    guilds: sealed.g.map(([id, name, icon]) => ({ id, name, icon })),
    issuedAt: sealed.t,
  };
}

/**
 * Reads the session, or returns the redirect to sign in that comes back to
 * this page afterwards (`/login?next=<path and query>`). A page that needs a
 * signed-in user starts with:
 *
 * ```ts
 * const session = await requireSession(request, env, now);
 * if (session instanceof Response) return session;
 * ```
 */
export async function requireSession(
  request: Request,
  env: { SIGNING_SECRET: string },
  now: number,
): Promise<Session | Response> {
  const session = await readSession(request, env, now);
  if (session) return session;
  const url = new URL(request.url);
  const next = safeNext(url.pathname + url.search);
  return seeOther(
    next === null ? "/login" : `/login?next=${encodeURIComponent(next)}`,
  );
}

/**
 * The server `guildId` from the session's list, or the 404 page when the
 * session does not list it. This only keeps people off pages of servers
 * they were not in at sign-in; the page must still check membership and
 * roles with the bot's token, since the list can be days old.
 */
export function requireGuild(
  session: Session,
  guildId: string,
): SessionGuild | Response {
  const guild = session.guilds.find((g) => g.id === guildId);
  return guild ?? htmlResponse(<NotFoundPage />, { status: 404 });
}

/** `text` cut to `max` characters (code points), ending in `…` when cut. */
function shorten(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}
