/**
 * Sign-in with Discord: the OAuth2 authorization code grant with the scopes
 * `identify guilds`. `/login` seals a random state into a ten-minute cookie
 * and sends the browser to Discord; `/auth/callback` checks the state,
 * exchanges the code, reads the user and their servers with the user's
 * access token, revokes the token, and starts the session with the servers
 * hikebot is in. The Worker never stores a Discord token, and never logs or
 * shows the client secret, a code or a token. "Sign-in and sessions" in
 * docs/design.md describes the flow.
 */
import {
  DiscordApiError,
  discordApi,
  oauthAuthorizeUrl,
  type DiscordApi,
  type OAuthClient,
} from "../../discord/api";
import type { RandomSource } from "../../polls/tally";
import { absoluteUrl } from "../../public-url";
import { open, seal } from "../../signing";
import { SignInCancelledPage } from "../pages/sign-in-cancelled";
import { SignInFailedPage } from "../pages/sign-in-failed";
import { seeOther } from "../redirect";
import { htmlResponse } from "../response";
import { clearCookie, readCookie, setCookie } from "./cookies";
import { safeNext } from "./next";
import {
  MAX_SESSION_GUILDS,
  sessionCookie,
  type Session,
  type SessionGuild,
} from "./session";

export const OAUTH_SCOPE = "identify guilds";
export const STATE_COOKIE = "__Host-hikebot_oauth_state";
export const STATE_TTL_MS = 10 * 60 * 1000;
export const CALLBACK_PATH = "/auth/callback";
/** How long the bot's server list is reused before it is read again. */
export const BOT_GUILDS_TTL_MS = 60 * 1000;
/** Discord's largest page of Get Current User Guilds. */
const GUILDS_PAGE = 200;

/** What sign-in needs from outside: the clock, randomness, a server cache. */
export interface SignInDeps {
  now: () => number;
  random: RandomSource;
  botGuilds: BotGuildCache;
  /** Replaces `fetch` for Discord calls, in tests. */
  fetch?: typeof fetch;
}

type SignInEnv = Parameters<typeof discordApi>[0] &
  Pick<
    Env,
    | "DISCORD_APPLICATION_ID"
    | "DISCORD_CLIENT_SECRET"
    | "PUBLIC_URL"
    | "SIGNING_SECRET"
  > & { DISCORD_OAUTH_AUTHORIZE_URL?: string };

/** The sealed state cookie: the random `state`, and where to go after. */
interface StatePayload {
  s: string;
  next: string | null;
}

/**
 * The ids of the servers the bot is in, read with the bot's token a page of
 * 200 at a time and reused for BOT_GUILDS_TTL_MS. One instance per isolate.
 */
export class BotGuildCache {
  private cached: { at: number; ids: ReadonlySet<string> } | undefined;

  async ids(api: DiscordApi, now: number): Promise<ReadonlySet<string>> {
    const cached = this.cached;
    if (cached && now >= cached.at && now - cached.at < BOT_GUILDS_TTL_MS) {
      return cached.ids;
    }
    const ids = new Set<string>();
    let after: string | undefined;
    for (;;) {
      const page = await api.getBotGuilds({ limit: GUILDS_PAGE, after });
      for (const guild of page) ids.add(guild.id);
      const last = page.at(-1);
      if (page.length < GUILDS_PAGE || !last) break;
      after = last.id;
    }
    this.cached = { at: now, ids };
    return ids;
  }
}

/**
 * `GET /login`: sets the state cookie and redirects to Discord's authorize
 * address. A `next` that is not a path on this site is ignored.
 */
export async function startSignIn(
  request: Request,
  env: SignInEnv,
  deps: SignInDeps,
): Promise<Response> {
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const state = randomHex(deps.random);
  const payload: StatePayload = { s: state, next };
  const sealed = await seal(
    env.SIGNING_SECRET,
    "oauth-state",
    payload,
    deps.now() + STATE_TTL_MS,
  );
  const location = oauthAuthorizeUrl(env, {
    clientId: env.DISCORD_APPLICATION_ID,
    scope: OAUTH_SCOPE,
    redirectUri: absoluteUrl(env, CALLBACK_PATH),
    state,
  });
  return seeOther(location, [
    ["Set-Cookie", setCookie(STATE_COOKIE, sealed, STATE_TTL_MS / 1000)],
  ]);
}

/**
 * `GET /auth/callback`: finishes sign-in, or answers the cancelled page
 * (the user said no at Discord) or the failed page: 400 for a missing,
 * expired or mismatched state (no code is exchanged), 502 when Discord
 * fails. It always clears the state cookie, so a callback works once.
 */
export async function finishSignIn(
  request: Request,
  env: SignInEnv,
  ctx: ExecutionContext,
  deps: SignInDeps,
): Promise<Response> {
  const now = deps.now();
  const query = new URL(request.url).searchParams;
  const clearState: [string, string] = [
    "Set-Cookie",
    clearCookie(STATE_COOKIE),
  ];
  const failed = (status: number) =>
    htmlResponse(<SignInFailedPage />, { status, headers: [clearState] });

  const sealed = readCookie(request, STATE_COOKIE);
  const state =
    sealed === null
      ? null
      : await open<StatePayload>(
          env.SIGNING_SECRET,
          "oauth-state",
          sealed,
          now,
        );
  const given = query.get("state");
  if (!state || given === null || !sameText(given, state.s)) return failed(400);

  const error = query.get("error");
  if (error === "access_denied") {
    return htmlResponse(<SignInCancelledPage />, { headers: [clearState] });
  }
  const code = query.get("code");
  if (error !== null || code === null || code === "") return failed(400);

  const api = discordApi(env, deps.fetch ? { fetch: deps.fetch } : {});
  const client: OAuthClient = {
    id: env.DISCORD_APPLICATION_ID,
    secret: env.DISCORD_CLIENT_SECRET,
  };
  let session: Session;
  try {
    const profile = await readProfile(
      api,
      client,
      code,
      absoluteUrl(env, CALLBACK_PATH),
      ctx,
    );
    const botGuilds = await deps.botGuilds.ids(api, now);
    session = {
      userId: profile.user.id,
      name: profile.user.global_name ?? profile.user.username,
      avatar: profile.user.avatar,
      guilds: sharedGuilds(profile.guilds, botGuilds),
      issuedAt: now,
    };
  } catch (caught) {
    console.error(`sign-in failed: ${describe(caught)}`);
    return failed(502);
  }
  return seeOther(state.next ?? "/servers", [
    ["Set-Cookie", await sessionCookie(env, session)],
    clearState,
  ]);
}

interface Profile {
  user: {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  };
  guilds: SessionGuild[];
}

/**
 * Exchanges the code, reads the user and their servers with the access
 * token, then revokes the token in the background whatever happened; a
 * failed revoke is logged and does not stop the sign-in. The token goes out
 * of scope when this returns.
 */
async function readProfile(
  api: DiscordApi,
  client: OAuthClient,
  code: string,
  redirectUri: string,
  ctx: ExecutionContext,
): Promise<Profile> {
  const token = await api.exchangeOAuthCode(client, code, redirectUri);
  try {
    const user = await api.getOAuthUser(token.access_token);
    const guilds = await api.getOAuthUserGuilds(token.access_token);
    return {
      user,
      guilds: guilds.map((g) => ({ id: g.id, name: g.name, icon: g.icon })),
    };
  } finally {
    ctx.waitUntil(
      api
        .revokeOAuthToken(client, token.access_token)
        .catch((caught: unknown) => {
          console.error(`sign-in token revoke failed: ${describe(caught)}`);
        }),
    );
  }
}

/**
 * The user's servers that the bot is in, by name, at most
 * MAX_SESSION_GUILDS of them.
 */
function sharedGuilds(
  guilds: SessionGuild[],
  botGuilds: ReadonlySet<string>,
): SessionGuild[] {
  return guilds
    .filter((g) => botGuilds.has(g.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, MAX_SESSION_GUILDS);
}

/** A failure as it may be logged: never a code, token or secret. */
function describe(caught: unknown): string {
  if (caught instanceof DiscordApiError) {
    return `${caught.method} ${caught.route} answered ${String(caught.status)}`;
  }
  return caught instanceof Error ? caught.name : "unknown error";
}

/** 16 random bytes as hex. */
function randomHex(random: RandomSource): string {
  return Array.from(random(new Uint32Array(4)), (word) =>
    word.toString(16).padStart(8, "0"),
  ).join("");
}

/** Compares two strings in time that does not depend on where they differ. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
