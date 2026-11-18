import {
  InteractionType,
  type APIApplicationCommandInteraction,
  type APIInteraction,
  type APIInteractionResponse,
  type APIMessageComponentInteraction,
  type APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { ephemeralNotice } from "../discord/responses";

export const UNAVAILABLE_MESSAGE = "This action is no longer available.";

/** What a handler gets besides the interaction: the guild's object state. */
export interface HandlerContext {
  env: Env;
  storage: DurableObjectStorage;
}

/**
 * A handler's answer. `response` is sent to Discord straight away;
 * `followUp`, if present, runs after that response has been returned, for
 * work that would not fit in Discord's 3-second window.
 */
export interface HandlerResult {
  response: APIInteractionResponse;
  followUp?: () => Promise<void>;
}

type Handler<I> = (
  interaction: I,
  context: HandlerContext,
) => HandlerResult | Promise<HandlerResult>;

export type CommandHandler = Handler<APIApplicationCommandInteraction>;
export type ComponentHandler = Handler<APIMessageComponentInteraction>;
export type ModalHandler = Handler<APIModalSubmitInteraction>;

/** `hb:<feature>` or `hb:<feature>:<action>`. */
const CUSTOM_ID_PREFIX = /^hb:[a-z0-9-]+(:[a-z0-9-]+)?$/;

/**
 * The handler registry. Commands match by name; components and modal
 * submits match by `custom_id` prefix on `:` boundaries, longest prefix first,
 * so `hb:poll:vote` receives `hb:poll:vote:12`.
 */
export class Router {
  private readonly commands = new Map<string, CommandHandler>();
  private readonly components = new Map<string, ComponentHandler>();
  private readonly modals = new Map<string, ModalHandler>();

  command(name: string, handler: CommandHandler): this {
    register(this.commands, name, handler, "command");
    return this;
  }

  component(prefix: string, handler: ComponentHandler): this {
    register(this.components, checkPrefix(prefix), handler, "component");
    return this;
  }

  modal(prefix: string, handler: ModalHandler): this {
    register(this.modals, checkPrefix(prefix), handler, "modal");
    return this;
  }

  async dispatch(
    interaction: APIInteraction,
    context: HandlerContext,
  ): Promise<HandlerResult> {
    switch (interaction.type) {
      case InteractionType.ApplicationCommand: {
        const handler = this.commands.get(interaction.data.name);
        if (handler) return handler(interaction, context);
        break;
      }
      case InteractionType.MessageComponent: {
        const handler = byPrefix(this.components, interaction.data.custom_id);
        if (handler) return handler(interaction, context);
        break;
      }
      case InteractionType.ModalSubmit: {
        const handler = byPrefix(this.modals, interaction.data.custom_id);
        if (handler) return handler(interaction, context);
        break;
      }
    }
    return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
  }
}

function register<H>(
  handlers: Map<string, H>,
  key: string,
  handler: H,
  kind: string,
): void {
  if (handlers.has(key)) {
    throw new Error(`a ${kind} handler for "${key}" is already registered`);
  }
  handlers.set(key, handler);
}

function checkPrefix(prefix: string): string {
  if (!CUSTOM_ID_PREFIX.test(prefix)) {
    throw new Error(
      `custom_id prefix "${prefix}" must look like hb:<feature> or hb:<feature>:<action>`,
    );
  }
  return prefix;
}

function byPrefix<H>(
  handlers: Map<string, H>,
  customId: string,
): H | undefined {
  let best: { prefix: string; handler: H } | undefined;
  for (const [prefix, handler] of handlers) {
    const matches = customId === prefix || customId.startsWith(`${prefix}:`);
    if (matches && (!best || prefix.length > best.prefix.length)) {
      best = { prefix, handler };
    }
  }
  return best?.handler;
}
// ci probe: temporary, reverted before merge
