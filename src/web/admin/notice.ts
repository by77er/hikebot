/**
 * What an admin's action leaves for the server's page it redirects to: the
 * panel's notes, or the refusal's sentence, and the retries offered after
 * it. It travels in the cookie `__Host-hikebot_notice`, sealed with
 * `SIGNING_SECRET` (purpose `notice`) for the signed-in user and the
 * server, for a minute; the server's page reads it once and clears it, so
 * a reload does not show it again and nobody can make a page show a
 * notice they wrote.
 */
import type { WebAdminAction } from "../../features/web-admin";
import { open, seal } from "../../signing";
import { clearCookie, readCookie, setCookie } from "../auth/cookies";

export const NOTICE_COOKIE = "__Host-hikebot_notice";
/** How long a notice waits for its page. */
export const NOTICE_TTL_MS = 60_000;
/** The longest a line may be in the cookie; longer ones end in `…`. */
export const MAX_NOTICE_LINE = 400;
/** The most the sealed notice's JSON may take, so the cookie stays small. */
const MAX_NOTICE_JSON = 2400;

export interface AdminNotice {
  /**
   * `done`: the action was done and `lines` are the panel's notes;
   * `finishing`: done, and its Discord work goes on; `refused`: nothing
   * changed and `lines` hold the panel's sentence.
   */
  kind: "done" | "finishing" | "refused";
  lines: string[];
  /** The retries offered after the action, each with what failed. */
  retries: WebAdminAction[];
}

interface NoticePayload {
  u: string;
  g: string;
  n: AdminNotice;
}

function shorten(line: string): string {
  return line.length <= MAX_NOTICE_LINE
    ? line
    : `${line.slice(0, MAX_NOTICE_LINE - 1)}…`;
}

/**
 * `notice` with each line shortened and, if it is still too long for the
 * cookie, its last lines and retries' notes dropped.
 */
export function fitNotice(notice: AdminNotice): AdminNotice {
  const fitted: AdminNotice = {
    ...notice,
    lines: notice.lines.map(shorten),
    retries: notice.retries.map((retry) => ({
      ...retry,
      note: retry.note === null ? null : shorten(retry.note),
    })),
  };
  while (
    JSON.stringify(fitted).length > MAX_NOTICE_JSON &&
    fitted.lines.length > 1
  ) {
    fitted.lines.pop();
  }
  if (JSON.stringify(fitted).length > MAX_NOTICE_JSON) {
    fitted.retries = fitted.retries.map((retry) => ({ ...retry, note: null }));
  }
  return fitted;
}

/** The `Set-Cookie` value that carries `notice` to the server's page. */
export async function noticeCookie(
  env: { SIGNING_SECRET: string },
  userId: string,
  guildId: string,
  notice: AdminNotice,
  now: number,
): Promise<string> {
  const payload: NoticePayload = {
    u: userId,
    g: guildId,
    n: fitNotice(notice),
  };
  const token = await seal(
    env.SIGNING_SECRET,
    "notice",
    payload,
    now + NOTICE_TTL_MS,
  );
  return setCookie(NOTICE_COOKIE, token, NOTICE_TTL_MS / 1000);
}

/**
 * The notice the request carries for this user and server, or null; and
 * the `Set-Cookie` value that clears the cookie when the request has one.
 */
export async function takeNotice(
  request: Request,
  env: { SIGNING_SECRET: string },
  userId: string,
  guildId: string,
  now: number,
): Promise<{ notice: AdminNotice | null; clear: string | null }> {
  const token = readCookie(request, NOTICE_COOKIE);
  if (token === null) return { notice: null, clear: null };
  const payload = await open<NoticePayload>(
    env.SIGNING_SECRET,
    "notice",
    token,
    now,
  );
  const notice =
    payload?.u === userId && payload.g === guildId ? payload.n : null;
  return { notice, clear: clearCookie(NOTICE_COOKIE) };
}
