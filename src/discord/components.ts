import {
  ButtonStyle,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
  TextInputStyle,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIChannelSelectComponent,
  type APIComponentInContainer,
  type APIComponentInLabel,
  type APIComponentInMessageActionRow,
  type APIContainerComponent,
  type APIInteractionResponseChannelMessageWithSource,
  type APIInteractionResponseDeferredChannelMessageWithSource,
  type APIInteractionResponseDeferredMessageUpdate,
  type APIInteractionResponseUpdateMessage,
  type APILabelComponent,
  type APIMediaGalleryComponent,
  type APIMediaGalleryItem,
  type APIMessageTopLevelComponent,
  type APIModalInteractionResponse,
  type APIModalInteractionResponseCallbackComponent,
  type APIModalSubmission,
  type APIRoleSelectComponent,
  type APISectionAccessoryComponent,
  type APISectionComponent,
  type APISelectMenuOption,
  type APISeparatorComponent,
  type APIStringSelectComponent,
  type APITextDisplayComponent,
  type APITextInputComponent,
  type ModalSubmitComponent,
} from "discord-api-types/v10";

/** Discord's limit on options in one select menu. */
export const MAX_SELECT_OPTIONS = 25;
/** Discord's limits on a media gallery's items and an item's alt text. */
export const MAX_GALLERY_ITEMS = 10;
export const MAX_MEDIA_DESCRIPTION = 1024;
/** Discord's limit on a `custom_id`. */
export const MAX_CUSTOM_ID_LENGTH = 100;

// Message parts.

export function textDisplay(content: string): APITextDisplayComponent {
  return { type: ComponentType.TextDisplay, content };
}

export function container(
  components: APIComponentInContainer[],
  options: { accent_color?: number; spoiler?: boolean } = {},
): APIContainerComponent {
  return { type: ComponentType.Container, ...options, components };
}

/** Up to three lines of text with a button (or thumbnail) beside them. */
export function section(
  text: string | string[],
  accessory: APISectionAccessoryComponent,
): APISectionComponent {
  const lines = typeof text === "string" ? [text] : text;
  return {
    type: ComponentType.Section,
    components: lines.map(textDisplay),
    accessory,
  };
}

/**
 * One to ten pictures, each at a URL or an attachment of the message
 * (`attachment://<file name>`), with optional alt text.
 */
export function mediaGallery(
  items: { url: string; description?: string; spoiler?: boolean }[],
): APIMediaGalleryComponent {
  if (items.length < 1 || items.length > MAX_GALLERY_ITEMS) {
    throw new RangeError(
      `a media gallery has 1 to ${String(MAX_GALLERY_ITEMS)} items, not ${String(items.length)}`,
    );
  }
  return {
    type: ComponentType.MediaGallery,
    items: items.map(({ url, description, spoiler }): APIMediaGalleryItem => {
      if (
        description !== undefined &&
        description.length > MAX_MEDIA_DESCRIPTION
      ) {
        throw new RangeError(
          `a media gallery item's description is at most ${String(MAX_MEDIA_DESCRIPTION)} characters`,
        );
      }
      return {
        media: { url },
        ...(description === undefined ? {} : { description }),
        ...(spoiler === undefined ? {} : { spoiler }),
      };
    }),
  };
}

export function separator(
  options: Omit<APISeparatorComponent, "type" | "id"> = {},
): APISeparatorComponent {
  return { type: ComponentType.Separator, ...options };
}

export function actionRow<T extends APIComponentInMessageActionRow>(
  ...components: T[]
): APIActionRowComponent<T> {
  return { type: ComponentType.ActionRow, components };
}

export function button(
  options: Omit<APIButtonComponentWithCustomId, "type" | "style" | "id"> & {
    style?: APIButtonComponentWithCustomId["style"];
  },
): APIButtonComponentWithCustomId {
  return {
    type: ComponentType.Button,
    style: ButtonStyle.Primary,
    ...options,
  };
}

export function stringSelect(
  options: Omit<APIStringSelectComponent, "type" | "id"> & {
    options: APISelectMenuOption[];
  },
): APIStringSelectComponent {
  if (
    options.options.length === 0 ||
    options.options.length > MAX_SELECT_OPTIONS
  ) {
    throw new Error(
      `a string select needs 1 to ${String(MAX_SELECT_OPTIONS)} options, got ${String(options.options.length)}`,
    );
  }
  return { type: ComponentType.StringSelect, ...options };
}

export function roleSelect(
  options: Omit<APIRoleSelectComponent, "type" | "id">,
): APIRoleSelectComponent {
  return { type: ComponentType.RoleSelect, ...options };
}

export function channelSelect(
  options: Omit<APIChannelSelectComponent, "type" | "id">,
): APIChannelSelectComponent {
  return { type: ComponentType.ChannelSelect, ...options };
}

// Modal parts.

export function label(
  text: string,
  component: APIComponentInLabel,
  description?: string,
): APILabelComponent {
  return {
    type: ComponentType.Label,
    label: text,
    ...(description === undefined ? {} : { description }),
    component,
  };
}

/** A text input for a Label; the label text goes on the Label. */
export function textInput(
  options: Omit<APITextInputComponent, "type" | "style" | "label" | "id"> & {
    style?: TextInputStyle;
  },
): APITextInputComponent {
  return {
    type: ComponentType.TextInput,
    style: TextInputStyle.Short,
    ...options,
  };
}

// Interaction responses.

/** A public Components V2 reply to the interaction. */
export function reply(
  components: APIMessageTopLevelComponent[],
): APIInteractionResponseChannelMessageWithSource {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: messageBody(components),
  };
}

/** A Components V2 reply only the user who acted can see. */
export function ephemeralReply(
  components: APIMessageTopLevelComponent[],
): APIInteractionResponseChannelMessageWithSource {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: messageBody(components, { ephemeral: true }),
  };
}

/** Replaces the message the component was on. */
export function update(
  components: APIMessageTopLevelComponent[],
): APIInteractionResponseUpdateMessage {
  return {
    type: InteractionResponseType.UpdateMessage,
    data: messageBody(components),
  };
}

/**
 * "Thinking...", to be replaced through `editOriginalInteractionResponse`
 * with a `messageBody`. Discord accepts only the ephemeral flag here, so the
 * Components V2 flag goes on that edit.
 */
export function deferredReply(
  options: { ephemeral?: boolean } = {},
): APIInteractionResponseDeferredChannelMessageWithSource {
  return {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    ...(options.ephemeral ? { data: { flags: MessageFlags.Ephemeral } } : {}),
  };
}

/** Acknowledges a component interaction; edit the message later. */
export function deferredUpdate(): APIInteractionResponseDeferredMessageUpdate {
  return { type: InteractionResponseType.DeferredMessageUpdate };
}

export function modal(
  customId: string,
  title: string,
  components: APIModalInteractionResponseCallbackComponent[],
): APIModalInteractionResponse {
  return {
    type: InteractionResponseType.Modal,
    data: { custom_id: customId, title, components },
  };
}

/**
 * The body of a Components V2 message for the REST client and webhook
 * edits.
 */
export function messageBody(
  components: APIMessageTopLevelComponent[],
  options: { ephemeral?: boolean } = {},
): {
  flags: MessageFlags;
  components: APIMessageTopLevelComponent[];
  allowed_mentions: { parse: [] };
} {
  if (options.ephemeral) {
    return {
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      components,
      allowed_mentions: { parse: [] },
    };
  }
  return {
    flags: MessageFlags.IsComponentsV2,
    components,
    allowed_mentions: { parse: [] },
  };
}

// Reading modal submits.

/** The submitted value of the text input `customId`, if the modal had it. */
export function textInputValue(
  submission: APIModalSubmission,
  customId: string,
): string | undefined {
  const field = findField(submission, customId);
  return field?.type === ComponentType.TextInput ? field.value : undefined;
}

/** The values chosen in the select `customId`; empty if there were none. */
export function selectValues(
  submission: APIModalSubmission,
  customId: string,
): string[] {
  const field = findField(submission, customId);
  switch (field?.type) {
    case ComponentType.StringSelect:
    case ComponentType.RoleSelect:
    case ComponentType.ChannelSelect:
    case ComponentType.UserSelect:
    case ComponentType.MentionableSelect:
      return field.values;
    default:
      return [];
  }
}

function findField(
  submission: APIModalSubmission,
  customId: string,
): ModalSubmitComponent | undefined {
  for (const component of submission.components) {
    const fields: ModalSubmitComponent[] =
      component.type === ComponentType.Label
        ? [component.component]
        : component.type === ComponentType.ActionRow
          ? component.components
          : [];
    const found = fields.find((field) => field.custom_id === customId);
    if (found) return found;
  }
  return undefined;
}

// custom_ids.

const SEGMENT = /^[a-z0-9-]+$/;

export interface ParsedCustomId {
  feature: string;
  action: string;
  arg?: string;
}

/** `hb:<feature>:<action>[:<arg>]`. The arg may itself contain `:`. */
export function customId(
  feature: string,
  action: string,
  arg?: string,
): string {
  if (!SEGMENT.test(feature) || !SEGMENT.test(action)) {
    throw new Error(
      `custom_id feature and action must match ${SEGMENT.source}, got "${feature}" and "${action}"`,
    );
  }
  const id = `hb:${feature}:${action}${arg === undefined ? "" : `:${arg}`}`;
  if (id.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error(
      `custom_id "${id}" is ${String(id.length)} characters; Discord allows ${String(MAX_CUSTOM_ID_LENGTH)}`,
    );
  }
  return id;
}

/** The parts of an `hb:` custom_id, or undefined if it is not one. */
export function parseCustomId(id: string): ParsedCustomId | undefined {
  const [prefix, feature, action, ...rest] = id.split(":");
  if (
    prefix !== "hb" ||
    feature === undefined ||
    action === undefined ||
    !SEGMENT.test(feature) ||
    !SEGMENT.test(action)
  ) {
    return undefined;
  }
  return rest.length === 0
    ? { feature, action }
    : { feature, action, arg: rest.join(":") };
}
