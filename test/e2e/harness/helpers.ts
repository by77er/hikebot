/**
 * Reading what the bot shows and acting on it as a member would. A `Member`
 * clicks, selects and submits only controls the bot actually rendered: the
 * custom_id must be on the message the fake Discord API stored (or in the
 * modal the Worker returned), so a test breaks if the bot shows a control it
 * cannot handle or handles one it never shows.
 */
import {
  ButtonStyle,
  ComponentType,
  InteractionResponseType,
  type APIApplicationCommandInteractionDataOption,
  type APIInteractionResponse,
  type APIModalInteractionResponseCallbackData,
} from "discord-api-types/v10";
import { vi } from "vitest";
import type { FakeDiscord, FakeMessage } from "./fake-discord";
import type { Actor, InteractionClient, SourceMessage } from "./interactions";

type Json = Record<string, unknown>;

function children(component: Json): unknown[] {
  const nested: unknown[] = [];
  if (Array.isArray(component.components)) {
    nested.push(...(component.components as unknown[]));
  }
  if (component.component !== undefined) nested.push(component.component);
  if (component.accessory !== undefined) nested.push(component.accessory);
  return nested;
}

/** Every component in a tree, depth first, in display order. */
export function allComponents(components: readonly unknown[]): Json[] {
  const found: Json[] = [];
  const visit = (component: unknown): void => {
    if (typeof component !== "object" || component === null) return;
    const json = component as Json;
    found.push(json);
    children(json).forEach(visit);
  };
  components.forEach(visit);
  return found;
}

/** The text a member reads: message content and every Text Display, in order. */
export function messageText(message: {
  content?: string;
  components?: readonly unknown[];
}): string {
  const lines = allComponents(message.components ?? [])
    .filter((c) => c.type === ComponentType.TextDisplay)
    .map((c) => String(c.content));
  return [message.content ?? "", ...lines].filter((s) => s !== "").join("\n");
}

/** The component with `customId` anywhere in a nested Components V2 tree. */
export function findComponent(
  components: readonly unknown[],
  customId: string,
): Json | undefined {
  return allComponents(components).find((c) => c.custom_id === customId);
}

/** Like `findComponent`, but fails with the ids that are there. */
export function getComponent(
  components: readonly unknown[],
  customId: string,
): Json {
  const component = findComponent(components, customId);
  if (!component) {
    const ids = allComponents(components)
      .map((c) => c.custom_id)
      .filter((id) => id !== undefined);
    throw new Error(
      `no component with custom_id "${customId}"; the message has: ${ids.map(String).join(", ") || "none"}`,
    );
  }
  return component;
}

/**
 * Waits until `check` stops throwing, checking again as the fake receives
 * requests, and returns what it returned. Fails after `timeout` ms with the
 * last error.
 */
export function eventually<T>(
  check: () => T | Promise<T>,
  options: { timeout?: number } = {},
): Promise<T> {
  return vi.waitFor(check, { timeout: options.timeout ?? 5_000, interval: 20 });
}

/** Waits for a message in `channelId` that `match` accepts, and returns it. */
export function waitForMessage(
  discord: FakeDiscord,
  channelId: string,
  match: (message: FakeMessage) => boolean = () => true,
  options: { timeout?: number } = {},
): Promise<FakeMessage> {
  return eventually(() => {
    const found = discord.channelMessages(channelId).find(match);
    if (!found) {
      throw new Error(
        `no matching message in channel ${channelId}; it has: ${JSON.stringify(discord.channelMessages(channelId).map(messageText))}`,
      );
    }
    return found;
  }, options);
}

/**
 * Waits until the original response to the interaction with `token` (after
 * any follow-up edits) satisfies `match`, and returns it. Use it for a
 * deferred reply that a follow-up job edits.
 */
export function waitForOriginalResponse(
  discord: FakeDiscord,
  token: string,
  match: (message: FakeMessage) => boolean,
  options: { timeout?: number } = {},
): Promise<FakeMessage> {
  return eventually(() => {
    const original = discord.originalResponse(token);
    if (!original || !match(original)) {
      throw new Error(
        `the original response is ${original ? JSON.stringify(messageText(original)) : "missing"}`,
      );
    }
    return original;
  }, options);
}

/** A guild member who uses the bot through the interaction client. */
export class Member {
  constructor(
    private readonly client: InteractionClient,
    readonly actor: Actor,
  ) {}

  /** Runs a slash command. */
  run(
    name: string,
    options: APIApplicationCommandInteractionDataOption[] = [],
  ): Promise<APIInteractionResponse> {
    return this.client.send(this.client.command(this.actor, name, options));
  }

  /**
   * The message as the fake Discord API stores it now, so a member only ever
   * acts on what the channel shows.
   */
  private stored(message: { id: string }): SourceMessage {
    const stored = this.client.discord.message(message.id);
    if (!stored) {
      throw new Error(
        `message ${message.id} is not in the fake Discord API; act only on messages the bot sent or the test seeded`,
      );
    }
    return stored;
  }

  /** Clicks the button `customId` on the stored `message`. */
  click(
    message: { id: string },
    customId: string,
  ): Promise<APIInteractionResponse> {
    const shown = this.stored(message);
    const button = getComponent(shown.components, customId);
    if (button.type !== ComponentType.Button) {
      throw new Error(
        `"${customId}" is a component of type ${String(button.type)}, not a button`,
      );
    }
    if (button.style === ButtonStyle.Link || button.disabled === true) {
      throw new Error(`the button "${customId}" cannot be clicked`);
    }
    return this.client.send(this.client.button(this.actor, customId, shown));
  }

  /**
   * Picks `values` in the select `customId` on the stored `message`: option
   * values for a string select, role ids for a role select, channel ids
   * (configured in the fake) for a channel select.
   */
  select(
    message: { id: string },
    customId: string,
    values: string[],
  ): Promise<APIInteractionResponse> {
    const shown = this.stored(message);
    const select = getComponent(shown.components, customId);
    checkSelection(select, customId, values);
    switch (select.type) {
      case ComponentType.StringSelect:
        return this.client.send(
          this.client.stringSelect(this.actor, customId, values, shown),
        );
      case ComponentType.RoleSelect:
        return this.client.send(
          this.client.roleSelect(this.actor, customId, values, shown),
        );
      case ComponentType.ChannelSelect: {
        const channels = values.map((id) => {
          const channel = this.client.discord.channel(id);
          if (!channel) {
            throw new Error(
              `add channel ${id} to the fake Discord API before selecting it`,
            );
          }
          return { id, type: channel.type };
        });
        return this.client.send(
          this.client.channelSelect(this.actor, customId, channels, shown),
        );
      }
      default:
        throw new Error(
          `"${customId}" is a component of type ${String(select.type)}, not a supported select`,
        );
    }
  }

  /**
   * Fills in and submits the modal the Worker answered with. `values` maps
   * each field's custom_id to the text typed or the options picked; every
   * id must be a field of that modal and every required field filled. Pass
   * the message whose component opened the modal, if one did.
   */
  submitModal(
    response: APIInteractionResponse,
    values: Record<string, string | string[]>,
    message?: { id: string },
  ): Promise<APIInteractionResponse> {
    if (response.type !== InteractionResponseType.Modal) {
      throw new Error(
        `expected a modal, got response type ${String(response.type)}`,
      );
    }
    const modal: APIModalInteractionResponseCallbackData = response.data;
    const fields = allComponents(modal.components).filter(
      (c) => typeof c.custom_id === "string" && c.type !== ComponentType.Label,
    );
    for (const id of Object.keys(values)) {
      if (!fields.some((f) => f.custom_id === id)) {
        throw new Error(
          `the modal has no field "${id}"; it has: ${fields.map((f) => String(f.custom_id)).join(", ")}`,
        );
      }
    }
    for (const field of fields) {
      const id = String(field.custom_id);
      const value = values[id];
      if (field.type === ComponentType.TextInput) {
        checkTextInput(field, id, value);
      } else if (value !== undefined) {
        if (typeof value === "string") {
          throw new Error(
            `the field "${id}" is a select; pass an array of values`,
          );
        }
        checkSelection(field, id, value);
      } else if (field.required !== false) {
        throw new Error(`the required field "${id}" was left empty`);
      }
    }
    const submitted: Record<string, string | string[]> = {};
    for (const field of fields) {
      const id = String(field.custom_id);
      submitted[id] =
        values[id] ?? (field.type === ComponentType.TextInput ? "" : []);
    }
    return this.client.send(
      this.client.modalSubmit(
        this.actor,
        modal.custom_id,
        submitted,
        message && this.stored(message),
      ),
    );
  }
}

function checkTextInput(
  field: Json,
  id: string,
  value: string | string[] | undefined,
): void {
  if (Array.isArray(value)) {
    throw new Error(`the field "${id}" is a text input; pass a string`);
  }
  const typed = value ?? "";
  const required = field.required !== false;
  if (required && typed === "") {
    throw new Error(`the required field "${id}" was left empty`);
  }
  const min = typeof field.min_length === "number" ? field.min_length : 0;
  const max = typeof field.max_length === "number" ? field.max_length : 4000;
  if (typed !== "" && (typed.length < min || typed.length > max)) {
    throw new Error(
      `Discord would not let a member submit ${String(typed.length)} characters in "${id}" (${String(min)} to ${String(max)})`,
    );
  }
}

function checkSelection(select: Json, id: string, values: string[]): void {
  const min = typeof select.min_values === "number" ? select.min_values : 1;
  const max = typeof select.max_values === "number" ? select.max_values : 1;
  if (values.length < min || values.length > max) {
    throw new Error(
      `the select "${id}" takes ${String(min)} to ${String(max)} values, not ${String(values.length)}`,
    );
  }
  if (select.type === ComponentType.StringSelect) {
    const options = Array.isArray(select.options)
      ? (select.options as Json[]).map((o) => o.value)
      : [];
    for (const value of values) {
      if (!options.includes(value)) {
        throw new Error(
          `the select "${id}" has no option "${value}"; it has: ${options.map(String).join(", ")}`,
        );
      }
    }
  }
  if (select.disabled === true) {
    throw new Error(`the select "${id}" is disabled`);
  }
}
