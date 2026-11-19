/**
 * The routes of web sign-in: `/login`, `/auth/callback`, `/logout`, and
 * `/servers`, the first page a signed-in user sees. `addSignInRoutes`
 * registers them on the web router with the system clock and randomness;
 * tests pass their own.
 */
import { systemNow } from "../../clock";
import { defaultRandom } from "../../polls/tally";
import { inviteUrl } from "../invite";
import { ServersPage } from "../pages/servers";
import { seeOther } from "../redirect";
import { htmlResponse } from "../response";
import type { WebRouter } from "../router";
import { checkPost, layoutUser } from "./csrf";
import {
  BotGuildCache,
  CALLBACK_PATH,
  finishSignIn,
  startSignIn,
  type SignInDeps,
} from "./oauth";
import { clearSessionCookie, readSession, requireSession } from "./session";

/** The clock, randomness and server cache of the deployed Worker. */
export const systemSignInDeps: SignInDeps = {
  now: systemNow,
  random: defaultRandom,
  botGuilds: new BotGuildCache(),
};

/** Adds the sign-in routes to `router` and returns it. */
export function addSignInRoutes(
  router: WebRouter,
  deps: SignInDeps = systemSignInDeps,
): WebRouter {
  return router
    .get("/login", (request, env) => startSignIn(request, env, deps))
    .get(CALLBACK_PATH, (request, env, ctx) =>
      finishSignIn(request, env, ctx, deps),
    )
    .post("/logout", async (request, env) => {
      const now = deps.now();
      const session = await readSession(request, env, now);
      if (!session)
        return seeOther("/", [["Set-Cookie", clearSessionCookie()]]);
      const form = await checkPost(request, env, session, now);
      if (form instanceof Response) return form;
      return seeOther("/", [["Set-Cookie", clearSessionCookie()]]);
    })
    .get("/servers", async (request, env) => {
      const now = deps.now();
      const session = await requireSession(request, env, now);
      if (session instanceof Response) return session;
      return htmlResponse(
        <ServersPage
          user={await layoutUser(env, session, now)}
          guilds={session.guilds}
          inviteUrl={inviteUrl(env)}
        />,
      );
    });
}
