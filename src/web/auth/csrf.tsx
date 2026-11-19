/**
 * Protects forms that change something from cross-site request forgery.
 * Every such form posts a hidden CSRF token, sealed with `SIGNING_SECRET`
 * (purpose `csrf`) and bound to the signed-in user's id, and the route
 * refuses the POST with 403 unless the token is valid for the session's user
 * and the browser says the request came from this site (`Sec-Fetch-Site`
 * or `Origin`). "Add a form that changes something" in src/web/AGENTS.md
 * shows the whole pattern.
 */
import { open, seal } from "../../signing";
import { userAvatarUrl } from "../components/avatar";
import type { LayoutUser } from "../layout";
import { ForbiddenPage } from "../pages/forbidden";
import { htmlResponse } from "../response";
import { SESSION_TTL_MS, type Session } from "./session";

/** The form field that carries the token. */
export const CSRF_FIELD = "csrf";
/** A token lasts as long as a session can. */
export const CSRF_TTL_MS = SESSION_TTL_MS;

interface CsrfPayload {
  u: string;
}

/** A CSRF token for the session's user, valid for CSRF_TTL_MS from `now`. */
export function csrfToken(
  env: { SIGNING_SECRET: string },
  session: Session,
  now: number,
): Promise<string> {
  const payload: CsrfPayload = { u: session.userId };
  return seal(env.SIGNING_SECRET, "csrf", payload, now + CSRF_TTL_MS);
}

/**
 * The hidden field that carries a form's CSRF token; put it inside every
 * `<form method="post">`.
 */
export function CsrfField({ token }: { token: string }) {
  return <input type="hidden" name={CSRF_FIELD} value={token} />;
}

/**
 * The signed-in user as `Layout` shows them: their name, their avatar's
 * address, and a CSRF token for the Sign out form.
 */
export async function layoutUser(
  env: { SIGNING_SECRET: string },
  session: Session,
  now: number,
): Promise<LayoutUser> {
  return {
    name: session.name,
    avatar: userAvatarUrl(session.userId, session.avatar, "small"),
    csrf: await csrfToken(env, session, now),
  };
}

/**
 * Whether the browser says the request came from a page of this site:
 * `Sec-Fetch-Site: same-origin` when the browser sends it, and an `Origin`
 * equal to the request's own origin when it sends that. A request with
 * neither header is refused; every current browser sends `Origin` on a POST.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  if (site === null && origin === null) return false;
  if (site !== null && site !== "same-origin") return false;
  return origin === null || origin === new URL(request.url).origin;
}

/**
 * Checks a POST from a form: it must come from this site (`isSameOrigin`)
 * and carry a CSRF token sealed for the session's user that has not expired
 * at `now`. Returns the form's fields, or the 403 page to answer with. A
 * route that changes something starts with:
 *
 * ```ts
 * const form = await checkPost(request, env, session, now);
 * if (form instanceof Response) return form;
 * ```
 */
export async function checkPost(
  request: Request,
  env: { SIGNING_SECRET: string },
  session: Session,
  now: number,
): Promise<FormData | Response> {
  if (request.method !== "POST" || !isSameOrigin(request)) return forbidden();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return forbidden();
  }
  const token = form.get(CSRF_FIELD);
  if (typeof token !== "string") return forbidden();
  const payload = await open<CsrfPayload>(
    env.SIGNING_SECRET,
    "csrf",
    token,
    now,
  );
  return payload?.u === session.userId ? form : forbidden();
}

/** The 403 page for a refused form. */
export function forbidden(): Response {
  return htmlResponse(<ForbiddenPage />, { status: 403 });
}
