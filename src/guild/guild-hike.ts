import { DurableObject } from "cloudflare:workers";
import type {
  APIInteraction,
  APIInteractionResponse,
} from "discord-api-types/v10";
import type { Calendar } from "../calendar/ical";
import { registerFeatures, runAlarm } from "../features";
import { loadCalendarFeed } from "../features/calendar-feed";
import { Router } from "./router";
import { applyMigrations } from "./schema";
import {
  runWebAction,
  type WebActionRequest,
  type WebActionResult,
} from "./web-action";
import {
  readWebView,
  WebViewCache,
  type WebViewRequest,
  type WebViewResult,
} from "./web-view";

/** What `handleInteraction` returns to the Worker over RPC. */
export interface InteractionOutcome {
  response: APIInteractionResponse;
  /** True when the Worker must call `runFollowUp(interaction.id)`. */
  followUp: boolean;
}

/**
 * One instance per Discord guild (`idFromName(guild_id)`). It holds all of the
 * guild's state and makes every change to it. Keep this class thin: features
 * live in their own files and register with the router.
 */
export class GuildHike extends DurableObject<Env> {
  readonly router: Router;
  private readonly followUps = new Map<string, () => Promise<void>>();
  private readonly webViewCache = new WebViewCache();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.router = registerFeatures(new Router());
    void ctx.blockConcurrencyWhile(() => {
      applyMigrations(ctx.storage);
      return Promise.resolve();
    });
  }

  async handleInteraction(
    interaction: APIInteraction,
  ): Promise<InteractionOutcome> {
    const result = await this.router.dispatch(interaction, {
      env: this.env,
      storage: this.ctx.storage,
    });
    if (result.followUp) {
      this.followUps.set(interaction.id, result.followUp);
    }
    return {
      response: result.response,
      followUp: result.followUp !== undefined,
    };
  }

  /**
   * The guild's calendar feed, for `guildId` (this object's name). The
   * Worker calls it only after checking the feed address's signature.
   */
  calendarFeed(guildId: string): Calendar {
    return loadCalendarFeed(this.ctx.storage, guildId);
  }

  /** Runs the scheduled jobs that are due, such as poll message refreshes. */
  override async alarm(): Promise<void> {
    await runAlarm(this.router, { env: this.env, storage: this.ctx.storage });
  }

  /**
   * Runs the follow-up job a handler queued for this interaction. The Worker
   * calls it inside `ctx.waitUntil` after sending the response, which keeps
   * this call alive. Returns false if there was no job (for example because
   * the object restarted in between).
   */
  async runFollowUp(interactionId: string): Promise<boolean> {
    const job = this.followUps.get(interactionId);
    if (!job) return false;
    this.followUps.delete(interactionId);
    await job();
    return true;
  }

  /**
   * The web pages' read of this guild for one signed-in user: not a member,
   * Discord unavailable, or everything the server's page shows. See
   * `readWebView`.
   */
  webView(request: WebViewRequest): Promise<WebViewResult> {
    return readWebView(
      { env: this.env, storage: this.ctx.storage },
      this.webViewCache,
      request,
    );
  }

  /**
   * An admin's round control posted from the web page: checks that the user
   * is an admin now, then runs it. See `runWebAction`.
   */
  adminAction(request: WebActionRequest): Promise<WebActionResult> {
    return runWebAction(
      { env: this.env, storage: this.ctx.storage },
      this.webViewCache,
      request,
    );
  }
}
