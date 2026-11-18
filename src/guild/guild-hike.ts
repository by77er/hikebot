import { DurableObject } from "cloudflare:workers";
import type {
  APIInteraction,
  APIInteractionResponse,
} from "discord-api-types/v10";
import { registerFeatures } from "../features";
import { Router } from "./router";
import { applyMigrations } from "./schema";

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
}
