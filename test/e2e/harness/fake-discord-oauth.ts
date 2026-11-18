/**
 * The fake Discord API's OAuth2 side, for web sign-in: the authorize page
 * a browser is sent to, the token and revoke endpoints, and the current
 * user's profile and servers for a user's access token or the bot's token.
 * `FakeDiscord` routes requests here before its bot routes. A scenario adds
 * Discord users with `addUser`; a browser says which user is signed in to
 * Discord, and whether they approve, with the cookies `PageClient.signIn`
 * sends. Each refusal names the rule in `validate.ts` it enforces.
 *
 * Discord's OAuth2 documentation:
 * https://docs.discord.com/developers/topics/oauth2#authorization-code-grant
 */
import type { IncomingMessage } from "node:http";
import { RULES, type Rule } from "./validate";

/** The cookie that says which Discord user the browser is signed in as. */
export const DISCORD_USER_COOKIE = "fake_discord_user";
/** The cookie that makes the user press Cancel on the authorize page. */
export const DISCORD_CONSENT_COOKIE = "fake_discord_consent";

export interface FakeUserGuild {
  id: string;
  name: string;
  icon?: string | null;
}

export interface FakeUser {
  id: string;
  username: string;
  globalName?: string | null;
  avatar?: string | null;
  /** The servers the user is in, whether or not the bot is. */
  guilds: FakeUserGuild[];
}

/** A reply in the fake's shape; see `Reply` in `fake-discord.ts`. */
export interface OAuthReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  unexpected?: boolean;
}

export interface FakeOAuthOptions {
  applicationId: string;
  /** The client secret the token and revoke routes accept. */
  clientSecret?: string;
  botToken: string;
  /** The redirect URIs registered for the application. */
  redirectUris: string[];
  /** The servers the bot is in. */
  botGuilds: () => { id: string; name: string }[];
}

interface Grant {
  userId: string;
  redirectUri: string;
  scope: string;
  used: boolean;
}

interface Token {
  userId: string;
  scope: string;
  revoked: boolean;
}

let issuedCount = 0;
/** A new value no other code or token shares, such as `fake-code-000001`. */
function opaque(kind: string): string {
  issuedCount += 1;
  return `fake-${kind}-${String(issuedCount).padStart(6, "0")}`;
}

export class FakeOAuth {
  /** Every authorization code and access token issued, for leak checks. */
  readonly issued: { codes: string[]; tokens: string[] } = {
    codes: [],
    tokens: [],
  };
  private readonly users = new Map<string, FakeUser>();
  private readonly grants = new Map<string, Grant>();
  private readonly tokens = new Map<string, Token>();

  constructor(private readonly options: FakeOAuthOptions) {}

  addUser(user: FakeUser): FakeUser {
    this.users.set(user.id, user);
    return user;
  }

  /** Whether the access token was revoked. */
  revoked(token: string): boolean {
    return this.tokens.get(token)?.revoked ?? false;
  }

  /** The tokens issued and not yet revoked. */
  liveTokens(): string[] {
    return [...this.tokens].filter(([, t]) => !t.revoked).map(([k]) => k);
  }

  /**
   * Answers an OAuth2 or current-user request, or returns undefined for a
   * route this file does not implement. `pathname` is the full path, with
   * `/api/v10` for API routes.
   */
  route(
    method: string,
    pathname: string,
    query: URLSearchParams,
    req: IncomingMessage,
    body: unknown,
  ): OAuthReply | undefined {
    if (method === "GET" && pathname === "/oauth2/authorize") {
      return this.authorize(query, req);
    }
    const path = pathname.replace(/^\/api\/v10/, "");
    if (method === "POST" && path === "/oauth2/token") {
      return this.token(req, body);
    }
    if (method === "POST" && path === "/oauth2/token/revoke") {
      return this.revoke(req, body);
    }
    if (method === "GET" && path === "/users/@me") return this.me(req);
    if (method === "GET" && path === "/users/@me/guilds") {
      return this.myGuilds(req, query);
    }
    return undefined;
  }

  /**
   * The authorize page. Discord shows an error page for an unknown client
   * or redirect URI; otherwise, once the user approves (or had approved,
   * with `prompt=none`), it redirects to the redirect URI with a code and
   * the state, and with `error=access_denied` when they cancel.
   */
  private authorize(query: URLSearchParams, req: IncomingMessage): OAuthReply {
    if (query.get("response_type") !== "code") {
      return oauthError(RULES.oauthResponseType, "unsupported_response_type");
    }
    if (query.get("client_id") !== this.options.applicationId) {
      return oauthError(RULES.oauthClientCredentials, "invalid_client");
    }
    const redirectUri = query.get("redirect_uri") ?? "";
    if (!this.options.redirectUris.includes(redirectUri)) {
      return oauthError(
        RULES.oauthRegisteredRedirectUri,
        "invalid_request",
        "Invalid OAuth2 redirect_uri",
      );
    }
    const scope = query.get("scope") ?? "";
    const cookies = parseCookies(req.headers.cookie);
    const user = this.users.get(cookies.get(DISCORD_USER_COOKIE) ?? "");
    if (!user) {
      return {
        status: 400,
        unexpected: true,
        body: { rule: "the browser is not signed in to a user the fake knows" },
      };
    }
    const back = new URL(redirectUri);
    const state = query.get("state");
    if (cookies.get(DISCORD_CONSENT_COOKIE) === "deny") {
      back.searchParams.set("error", "access_denied");
      back.searchParams.set(
        "error_description",
        "The resource owner or authorization server denied the request",
      );
    } else {
      const code = opaque("code");
      this.issued.codes.push(code);
      this.grants.set(code, {
        userId: user.id,
        redirectUri,
        scope,
        used: false,
      });
      back.searchParams.set("code", code);
    }
    if (state !== null) back.searchParams.set("state", state);
    return { status: 302, body: undefined, headers: { Location: back.href } };
  }

  private token(req: IncomingMessage, body: unknown): OAuthReply {
    const form = this.formOf(req, body);
    if (!(form instanceof URLSearchParams)) return form;
    if (form.get("grant_type") !== "authorization_code") {
      return oauthError(RULES.oauthGrantType, "unsupported_grant_type");
    }
    const code = form.get("code") ?? "";
    const grant = this.grants.get(code);
    if (!grant) {
      return oauthError(
        RULES.oauthCodeSingleUse,
        "invalid_grant",
        'Invalid "code" in request.',
      );
    }
    if (grant.used) {
      return oauthError(
        RULES.oauthCodeSingleUse,
        "invalid_grant",
        'Invalid "code" in request.',
      );
    }
    grant.used = true;
    if (form.get("redirect_uri") !== grant.redirectUri) {
      return oauthError(
        RULES.oauthRedirectUriMatches,
        "invalid_grant",
        'Invalid "redirect_uri" in request.',
      );
    }
    const accessToken = opaque("access");
    this.issued.tokens.push(accessToken);
    this.tokens.set(accessToken, {
      userId: grant.userId,
      scope: grant.scope,
      revoked: false,
    });
    return {
      status: 200,
      body: {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 604800,
        refresh_token: opaque("refresh"),
        scope: grant.scope,
      },
    };
  }

  private revoke(req: IncomingMessage, body: unknown): OAuthReply {
    const form = this.formOf(req, body);
    if (!(form instanceof URLSearchParams)) return form;
    const token = this.tokens.get(form.get("token") ?? "");
    if (token) token.revoked = true;
    return { status: 200, body: {} };
  }

  private me(req: IncomingMessage): OAuthReply {
    if (req.headers.authorization === `Bot ${this.options.botToken}`) {
      return {
        status: 200,
        body: userObject(
          {
            id: this.options.applicationId,
            username: "hikebot",
            guilds: [],
          },
          true,
        ),
      };
    }
    const token = this.bearer(req, "identify");
    if ("status" in token) return token;
    const user = this.users.get(token.userId);
    return user
      ? { status: 200, body: userObject(user, false) }
      : unauthorized("the token's user is gone");
  }

  private myGuilds(req: IncomingMessage, query: URLSearchParams): OAuthReply {
    const limit = Number(query.get("limit") ?? "200");
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return oauthError(
        RULES.currentUserGuildsLimit,
        "invalid_request",
        "limit must be 1 to 200",
        50035,
      );
    }
    let guilds: FakeUserGuild[];
    if (req.headers.authorization === `Bot ${this.options.botToken}`) {
      guilds = this.options.botGuilds();
    } else {
      const token = this.bearer(req, "guilds");
      if ("status" in token) return token;
      guilds = this.users.get(token.userId)?.guilds ?? [];
    }
    const after = BigInt(query.get("after") ?? "0");
    const page = [...guilds]
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
      .filter((g) => BigInt(g.id) > after)
      .slice(0, limit);
    return {
      status: 200,
      body: page.map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon ?? null,
        banner: null,
        owner: false,
        permissions: "0",
        features: [],
      })),
    };
  }

  /**
   * The token of an `Authorization: Bearer` header, if it is live and was
   * granted `scope`; Discord answers 401 otherwise.
   */
  private bearer(req: IncomingMessage, scope: string): Token | OAuthReply {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    const token = match ? this.tokens.get(match[1] ?? "") : undefined;
    if (!token || token.revoked) return unauthorized("no live access token");
    if (!token.scope.split(" ").includes(scope)) {
      return unauthorized(`the token lacks the ${scope} scope`);
    }
    return token;
  }

  /**
   * The form body of a token or revoke request, after checking its content
   * type and the client's credentials (HTTP Basic, or in the body).
   */
  private formOf(
    req: IncomingMessage,
    body: unknown,
  ): URLSearchParams | OAuthReply {
    if (req.headers["content-type"] !== "application/x-www-form-urlencoded") {
      return oauthError(RULES.oauthFormBody, "invalid_request");
    }
    const form = new URLSearchParams(typeof body === "string" ? body : "");
    let id = form.get("client_id");
    let secret = form.get("client_secret");
    const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
    if (basic) {
      const decoded = Buffer.from(basic[1] ?? "", "base64").toString("utf8");
      const at = decoded.indexOf(":");
      id = decoded.slice(0, at);
      secret = decoded.slice(at + 1);
    }
    if (
      this.options.clientSecret === undefined ||
      id !== this.options.applicationId ||
      secret !== this.options.clientSecret
    ) {
      return oauthError(
        RULES.oauthClientCredentials,
        "invalid_client",
        undefined,
        undefined,
        401,
      );
    }
    return form;
  }
}

function userObject(user: FakeUser, bot: boolean): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    discriminator: "0",
    global_name: user.globalName ?? null,
    avatar: user.avatar ?? null,
    ...(bot ? { bot: true } : {}),
  };
}

/**
 * An OAuth2 error as Discord's token endpoint gives it (RFC 6749 section
 * 5.2), naming the rule. Never echoes a code, token or secret.
 */
function oauthError(
  rule: Rule,
  error: string,
  description = rule.id,
  code?: number,
  status = 400,
): OAuthReply {
  return {
    status,
    unexpected: true,
    body: {
      error,
      error_description: description,
      ...(code === undefined ? {} : { code, message: description }),
      rule: rule.id,
      docs: rule.docs,
    },
  };
}

function unauthorized(why: string): OAuthReply {
  return {
    status: 401,
    unexpected: true,
    body: { message: "401: Unauthorized", code: 0, rule: why },
  };
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0)
      cookies.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return cookies;
}
