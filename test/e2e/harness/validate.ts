/**
 * Discord's payload rules, checked the way Discord checks them. The fake
 * Discord API runs these on every message, thread and command the Worker
 * sends, and the interaction client runs them on every interaction response,
 * so a payload Discord would refuse fails the test instead of production.
 *
 * Each rule has an id that appears in the 400 the fake returns, and a link to
 * the Discord docs that state the limit.
 */
import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
} from "discord-api-types/v10";

const COMPONENTS_REFERENCE =
  "https://discord.com/developers/docs/components/reference";
const CREATE_MESSAGE =
  "https://discord.com/developers/docs/resources/message#create-message";
const RESPONDING =
  "https://discord.com/developers/docs/interactions/receiving-and-responding#responding-to-an-interaction";
const START_FORUM_THREAD =
  "https://discord.com/developers/docs/resources/channel#start-thread-in-forum-or-media-channel";
const COMMAND_NAMING =
  "https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-naming";
const COMMAND_OBJECT =
  "https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-structure";

/** A rule the fake enforces. `docs` is where Discord states it. */
export interface Rule {
  id: string;
  docs: string;
}

function rule(id: string, docs: string): Rule {
  return { id, docs };
}

export const RULES = {
  /** "This flag ... disables traditional content and embeds." */
  v2NoContentOrEmbeds: rule(
    "components-v2-no-content-or-embeds",
    "https://discord.com/developers/docs/components/using-message-components",
  ),
  /** Layout and content components only exist in Components V2 messages. */
  v2FlagRequired: rule("components-v2-flag-required", CREATE_MESSAGE),
  /** "Setting the IS_COMPONENTS_V2 message flag cannot be reverted." */
  v2FlagPermanent: rule(
    "components-v2-flag-permanent",
    "https://discord.com/developers/docs/components/using-message-components",
  ),
  /** "Messages allow up to 40 total components." */
  maxComponents: rule("message-max-40-components", COMPONENTS_REFERENCE),
  /** Text across all Text Displays in a V2 message is capped at 4000. */
  maxText: rule("message-max-4000-text-characters", CREATE_MESSAGE),
  /** A message without IS_COMPONENTS_V2: content up to 2000 characters. */
  maxContent: rule("message-content-max-2000", CREATE_MESSAGE),
  /** "Up to 5 contextually grouped buttons" or a single select. */
  actionRow: rule(
    "action-row-5-buttons-or-1-select",
    `${COMPONENTS_REFERENCE}#action-row`,
  ),
  /** One to three Text Displays, and an accessory. */
  section: rule("section-contents", `${COMPONENTS_REFERENCE}#section`),
  /** "Specified choices in a select menu; max 25". */
  selectOptions: rule(
    "select-1-to-25-options",
    `${COMPONENTS_REFERENCE}#string-select`,
  ),
  /** min_values 0-25, max_values 1-25, min <= max, max <= option count. */
  selectValues: rule(
    "select-min-max-values",
    `${COMPONENTS_REFERENCE}#string-select`,
  ),
  /** "max 150 characters". */
  selectPlaceholder: rule(
    "select-placeholder-max-150",
    `${COMPONENTS_REFERENCE}#string-select`,
  ),
  /** Option label, value and description: "max 100 characters". */
  selectOptionText: rule(
    "select-option-text-max-100",
    `${COMPONENTS_REFERENCE}#string-select-select-option-structure`,
  ),
  /** "Text that appears on the button; max 80 characters". */
  buttonLabel: rule("button-label-max-80", `${COMPONENTS_REFERENCE}#button`),
  /** Link buttons carry a url and no custom_id; other buttons a custom_id. */
  buttonTarget: rule("button-custom-id-or-url", `${COMPONENTS_REFERENCE}#button`),
  /** "This field is a string of 1 to 100 characters". */
  customIdLength: rule(
    "custom-id-1-to-100-characters",
    `${COMPONENTS_REFERENCE}#anatomy-of-a-component`,
  ),
  /** "Multiple components on the same message must not share the same custom_id." */
  customIdUnique: rule(
    "custom-id-unique-in-message",
    `${COMPONENTS_REFERENCE}#anatomy-of-a-component`,
  ),
  /** Modal title: "max 45 characters". */
  modalTitle: rule(
    "modal-title-max-45",
    `${RESPONDING}#interaction-response-object-modal`,
  ),
  /** A modal holds 1 to 5 top-level components. */
  modalComponents: rule(
    "modal-1-to-5-components",
    `${RESPONDING}#interaction-response-object-modal`,
  ),
  /** Label text: "max 45 characters"; description "max 100 characters". */
  labelText: rule("label-text-max-45", `${COMPONENTS_REFERENCE}#label`),
  /** min_length 0-4000, max_length 1-4000, value up to 4000, placeholder up to 100. */
  textInput: rule("text-input-limits", `${COMPONENTS_REFERENCE}#text-input`),
  /** Thread name: 1-100 characters. */
  threadName: rule("thread-name-1-to-100", START_FORUM_THREAD),
  /** "Creates a new thread in a forum or a media channel". */
  forumOnly: rule("forum-thread-needs-forum-channel", START_FORUM_THREAD),
  /** Which callback types each interaction type accepts. */
  responseType: rule(
    "interaction-response-type",
    `${RESPONDING}#interaction-response-object-interaction-callback-type`,
  ),
  /** A deferred response carries no message, only the ephemeral flag. */
  deferredFlags: rule(
    "deferred-response-ephemeral-flag-only",
    `${RESPONDING}#interaction-response-object-messages`,
  ),
  /** Chat input command names: 1-32 lowercase letters, digits, - or _. */
  commandName: rule("command-name", COMMAND_NAMING),
  /** Chat input command descriptions: 1-100 characters. */
  commandDescription: rule("command-description-1-to-100", COMMAND_OBJECT),
} as const;

export interface Violation {
  rule: Rule;
  /** Where in the payload, for example `components[0].components[2].label`. */
  path: string;
  detail: string;
}

/** Formats violations as the fake's 400 message names them. */
export function describeViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => `${v.rule.id} at ${v.path || "(root)"}: ${v.detail} (${v.rule.docs})`)
    .join("; ");
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

class Checker {
  readonly violations: Violation[] = [];
  private readonly customIds = new Map<string, string>();
  components = 0;
  textCharacters = 0;

  fail(rule: Rule, path: string, detail: string): void {
    this.violations.push({ rule, path, detail });
  }

  maxLength(
    rule: Rule,
    path: string,
    value: unknown,
    max: number,
    min = 0,
  ): void {
    const s = text(value);
    if (s === undefined) {
      if (min > 0) this.fail(rule, path, `is required`);
      return;
    }
    if (s.length > max) {
      this.fail(rule, path, `is ${String(s.length)} characters, max ${String(max)}`);
    } else if (s.length < min) {
      this.fail(rule, path, `is ${String(s.length)} characters, min ${String(min)}`);
    }
  }

  customId(path: string, value: unknown): void {
    const at = path ? `${path}.custom_id` : "custom_id";
    const id = text(value);
    if (id === undefined || id.length < 1 || id.length > 100) {
      this.fail(
        RULES.customIdLength,
        at,
        id === undefined
          ? "is missing"
          : `is ${String(id.length)} characters, must be 1 to 100`,
      );
      return;
    }
    const first = this.customIds.get(id);
    if (first !== undefined) {
      this.fail(RULES.customIdUnique, at, `"${id}" is also used at ${first}`);
    } else {
      this.customIds.set(id, at);
    }
  }
}

const V2_ONLY_TYPES = new Set<number>([
  ComponentType.Section,
  ComponentType.TextDisplay,
  ComponentType.Thumbnail,
  ComponentType.MediaGallery,
  ComponentType.File,
  ComponentType.Separator,
  ComponentType.Container,
]);

const SELECT_TYPES = new Set<number>([
  ComponentType.StringSelect,
  ComponentType.UserSelect,
  ComponentType.RoleSelect,
  ComponentType.MentionableSelect,
  ComponentType.ChannelSelect,
]);

/**
 * Checks a message body as Create Message, Edit Message, a webhook edit or
 * follow-up, or the `data` of a message interaction response receives it.
 * `existingFlags` are the flags of the message being edited, if any.
 */
export function validateMessage(
  body: unknown,
  options: { existingFlags?: number } = {},
): Violation[] {
  const c = new Checker();
  if (!isObject(body)) {
    c.fail(RULES.v2FlagRequired, "", "the body is not a JSON object");
    return c.violations;
  }
  const flags =
    typeof body.flags === "number" ? body.flags : (options.existingFlags ?? 0);
  const existingV2 =
    ((options.existingFlags ?? 0) & MessageFlags.IsComponentsV2) !== 0;
  const v2 = (flags & MessageFlags.IsComponentsV2) !== 0;
  if (existingV2 && !v2) {
    c.fail(
      RULES.v2FlagPermanent,
      "flags",
      "the message was sent with IS_COMPONENTS_V2 and the edit removes it",
    );
  }

  const components = list(body.components);
  if (v2) {
    if (text(body.content) !== undefined && body.content !== "") {
      c.fail(
        RULES.v2NoContentOrEmbeds,
        "content",
        "a message with IS_COMPONENTS_V2 (32768) cannot set content; put the text in a Text Display",
      );
    }
    if (list(body.embeds).length > 0) {
      c.fail(
        RULES.v2NoContentOrEmbeds,
        "embeds",
        "a message with IS_COMPONENTS_V2 (32768) cannot set embeds",
      );
    }
  } else {
    c.maxLength(RULES.maxContent, "content", body.content, 2000);
    if (components.length > 5) {
      c.fail(
        RULES.actionRow,
        "components",
        `has ${String(components.length)} action rows, max 5 without IS_COMPONENTS_V2`,
      );
    }
  }

  components.forEach((component, i) => {
    checkMessageComponent(c, component, `components[${String(i)}]`, v2, true);
  });

  if (c.components > 40) {
    c.fail(
      RULES.maxComponents,
      "components",
      `has ${String(c.components)} components counting nested ones, max 40`,
    );
  }
  if (c.textCharacters > 4000) {
    c.fail(
      RULES.maxText,
      "components",
      `has ${String(c.textCharacters)} characters of text, max 4000`,
    );
  }
  return c.violations;
}

function checkMessageComponent(
  c: Checker,
  component: unknown,
  path: string,
  v2: boolean,
  topLevel: boolean,
): void {
  c.components += 1;
  if (!isObject(component) || typeof component.type !== "number") {
    c.fail(RULES.v2FlagRequired, path, "is not a component object");
    return;
  }
  const type = component.type;
  if (!v2 && V2_ONLY_TYPES.has(type)) {
    c.fail(
      RULES.v2FlagRequired,
      path,
      `component type ${String(type)} needs the IS_COMPONENTS_V2 flag (32768)`,
    );
    return;
  }
  if (!v2 && topLevel && type !== ComponentType.ActionRow) {
    c.fail(
      RULES.actionRow,
      path,
      "without IS_COMPONENTS_V2 every top-level component is an action row",
    );
  }

  switch (type) {
    case ComponentType.ActionRow: {
      const children = list(component.components);
      const selects = children.filter(
        (child) => isObject(child) && SELECT_TYPES.has(child.type as number),
      ).length;
      const buttons = children.filter(
        (child) => isObject(child) && child.type === ComponentType.Button,
      ).length;
      if (
        children.length === 0 ||
        (selects > 0 && children.length !== 1) ||
        (selects === 0 && (buttons !== children.length || buttons > 5))
      ) {
        c.fail(
          RULES.actionRow,
          path,
          `holds ${String(buttons)} buttons and ${String(selects)} selects among ${String(children.length)} components`,
        );
      }
      children.forEach((child, i) => {
        checkMessageComponent(
          c,
          child,
          `${path}.components[${String(i)}]`,
          v2,
          false,
        );
      });
      return;
    }
    case ComponentType.Button:
      checkButton(c, component, path);
      return;
    case ComponentType.StringSelect:
    case ComponentType.UserSelect:
    case ComponentType.RoleSelect:
    case ComponentType.MentionableSelect:
    case ComponentType.ChannelSelect:
      checkSelect(c, component, path);
      return;
    case ComponentType.TextDisplay:
      c.textCharacters += text(component.content)?.length ?? 0;
      return;
    case ComponentType.Section: {
      const children = list(component.components);
      if (
        children.length < 1 ||
        children.length > 3 ||
        !children.every(
          (child) => isObject(child) && child.type === ComponentType.TextDisplay,
        )
      ) {
        c.fail(
          RULES.section,
          `${path}.components`,
          "must hold one to three Text Displays",
        );
      }
      children.forEach((child, i) => {
        checkMessageComponent(
          c,
          child,
          `${path}.components[${String(i)}]`,
          v2,
          false,
        );
      });
      if (component.accessory === undefined) {
        c.fail(RULES.section, `${path}.accessory`, "is required");
      } else {
        checkMessageComponent(
          c,
          component.accessory,
          `${path}.accessory`,
          v2,
          false,
        );
      }
      return;
    }
    case ComponentType.Container:
      list(component.components).forEach((child, i) => {
        checkMessageComponent(
          c,
          child,
          `${path}.components[${String(i)}]`,
          v2,
          false,
        );
      });
      return;
    case ComponentType.TextInput:
      c.fail(
        RULES.actionRow,
        path,
        "a text input belongs in a modal, not in a message",
      );
      return;
    default:
      return;
  }
}

function checkButton(c: Checker, button: Json, path: string): void {
  c.maxLength(RULES.buttonLabel, `${path}.label`, button.label, 80);
  if (button.style === ButtonStyle.Link) {
    if (text(button.url) === undefined || button.custom_id !== undefined) {
      c.fail(
        RULES.buttonTarget,
        path,
        "a link button needs a url and no custom_id",
      );
    }
  } else if (button.style === ButtonStyle.Premium) {
    if (button.custom_id !== undefined) {
      c.fail(RULES.buttonTarget, path, "a premium button has no custom_id");
    }
  } else {
    if (button.url !== undefined) {
      c.fail(RULES.buttonTarget, path, "only a link button has a url");
    }
    c.customId(path, button.custom_id);
  }
}

function checkSelect(c: Checker, select: Json, path: string): void {
  c.customId(path, select.custom_id);
  c.maxLength(
    RULES.selectPlaceholder,
    `${path}.placeholder`,
    select.placeholder,
    150,
  );
  const options = list(select.options);
  if (select.type === ComponentType.StringSelect) {
    if (options.length < 1 || options.length > 25) {
      c.fail(
        RULES.selectOptions,
        `${path}.options`,
        `has ${String(options.length)} options, must be 1 to 25`,
      );
    }
    options.forEach((option, i) => {
      const at = `${path}.options[${String(i)}]`;
      const o = isObject(option) ? option : {};
      c.maxLength(RULES.selectOptionText, `${at}.label`, o.label, 100, 1);
      c.maxLength(RULES.selectOptionText, `${at}.value`, o.value, 100, 1);
      c.maxLength(
        RULES.selectOptionText,
        `${at}.description`,
        o.description,
        100,
      );
    });
  }
  const min = select.min_values ?? 1;
  const max = select.max_values ?? 1;
  if (typeof min !== "number" || min < 0 || min > 25) {
    c.fail(RULES.selectValues, `${path}.min_values`, "must be 0 to 25");
  }
  if (typeof max !== "number" || max < 1 || max > 25) {
    c.fail(RULES.selectValues, `${path}.max_values`, "must be 1 to 25");
  }
  if (typeof min === "number" && typeof max === "number" && min > max) {
    c.fail(
      RULES.selectValues,
      path,
      `min_values ${String(min)} is above max_values ${String(max)}`,
    );
  }
  if (
    select.type === ComponentType.StringSelect &&
    typeof max === "number" &&
    options.length > 0 &&
    max > options.length
  ) {
    c.fail(
      RULES.selectValues,
      `${path}.max_values`,
      `is ${String(max)} but the select has ${String(options.length)} options`,
    );
  }
}

/** Checks the `data` of a modal response. */
export function validateModal(data: unknown): Violation[] {
  const c = new Checker();
  if (!isObject(data)) {
    c.fail(RULES.modalComponents, "", "the modal is not a JSON object");
    return c.violations;
  }
  c.maxLength(RULES.modalTitle, "title", data.title, 45, 1);
  c.customId("", data.custom_id);
  const components = list(data.components);
  if (components.length < 1 || components.length > 5) {
    c.fail(
      RULES.modalComponents,
      "components",
      `has ${String(components.length)} components, must be 1 to 5`,
    );
  }
  components.forEach((component, i) => {
    const path = `components[${String(i)}]`;
    const o = isObject(component) ? component : {};
    switch (o.type) {
      case ComponentType.Label: {
        c.maxLength(RULES.labelText, `${path}.label`, o.label, 45, 1);
        c.maxLength(
          RULES.labelText,
          `${path}.description`,
          o.description,
          100,
        );
        checkModalField(c, o.component, `${path}.component`);
        return;
      }
      case ComponentType.TextDisplay:
        return;
      case ComponentType.ActionRow: {
        const children = list(o.components);
        if (children.length !== 1) {
          c.fail(
            RULES.modalComponents,
            path,
            "an action row in a modal holds exactly one text input",
          );
        }
        children.forEach((child, j) => {
          checkModalField(c, child, `${path}.components[${String(j)}]`);
        });
        return;
      }
      default:
        c.fail(
          RULES.modalComponents,
          path,
          `component type ${String(o.type)} cannot be a top-level modal component; wrap fields in a Label`,
        );
    }
  });
  return c.violations;
}

function checkModalField(c: Checker, field: unknown, path: string): void {
  const o = isObject(field) ? field : {};
  if (o.type === ComponentType.TextInput) {
    c.customId(path, o.custom_id);
    const min = o.min_length;
    const max = o.max_length;
    if (min !== undefined && (typeof min !== "number" || min < 0 || min > 4000)) {
      c.fail(RULES.textInput, `${path}.min_length`, "must be 0 to 4000");
    }
    if (max !== undefined && (typeof max !== "number" || max < 1 || max > 4000)) {
      c.fail(RULES.textInput, `${path}.max_length`, "must be 1 to 4000");
    }
    c.maxLength(RULES.textInput, `${path}.value`, o.value, 4000);
    c.maxLength(RULES.textInput, `${path}.placeholder`, o.placeholder, 100);
    return;
  }
  if (typeof o.type === "number" && SELECT_TYPES.has(o.type)) {
    checkSelect(c, o, path);
    return;
  }
  if (
    o.type === ComponentType.FileUpload ||
    o.type === ComponentType.RadioGroup ||
    o.type === ComponentType.CheckboxGroup ||
    o.type === ComponentType.Checkbox
  ) {
    c.customId(path, o.custom_id);
    return;
  }
  c.fail(
    RULES.modalComponents,
    path,
    `component type ${String(o.type)} is not a modal field`,
  );
}

/** Checks the body of Start Thread in Forum or Media Channel. */
export function validateForumThread(
  body: unknown,
  parentType: number,
): Violation[] {
  const violations: Violation[] = [];
  if (
    parentType !== ChannelType.GuildForum &&
    parentType !== ChannelType.GuildMedia
  ) {
    violations.push({
      rule: RULES.forumOnly,
      path: "",
      detail: `the channel has type ${String(parentType)}; forum threads start only in forum (15) or media (16) channels`,
    });
  }
  const o = isObject(body) ? body : {};
  const name = text(o.name);
  if (name === undefined || name.length < 1 || name.length > 100) {
    violations.push({
      rule: RULES.threadName,
      path: "name",
      detail:
        name === undefined
          ? "is required"
          : `is ${String(name.length)} characters, must be 1 to 100`,
    });
  }
  if (!isObject(o.message)) {
    violations.push({
      rule: RULES.v2FlagRequired,
      path: "message",
      detail: "a forum thread needs its first message",
    });
  } else {
    for (const v of validateMessage(o.message)) {
      violations.push({ ...v, path: `message.${v.path}` });
    }
  }
  return violations;
}

/** Checks the body of Bulk Overwrite Global Application Commands. */
export function validateCommands(body: unknown): Violation[] {
  const violations: Violation[] = [];
  if (!Array.isArray(body)) {
    return [
      {
        rule: RULES.commandName,
        path: "",
        detail: "the body must be an array of commands",
      },
    ];
  }
  body.forEach((command, i) => {
    const o = isObject(command) ? command : {};
    const chatInput = o.type === undefined || o.type === 1;
    const name = text(o.name) ?? "";
    if (
      chatInput
        ? !/^[-_\p{L}\p{N}]{1,32}$/u.test(name) || name !== name.toLowerCase()
        : name.length < 1 || name.length > 32
    ) {
      violations.push({
        rule: RULES.commandName,
        path: `[${String(i)}].name`,
        detail: `"${name}" is not a valid command name`,
      });
    }
    const description = text(o.description) ?? "";
    if (chatInput && (description.length < 1 || description.length > 100)) {
      violations.push({
        rule: RULES.commandDescription,
        path: `[${String(i)}].description`,
        detail: `is ${String(description.length)} characters, must be 1 to 100`,
      });
    }
  });
  return violations;
}

const ALLOWED_RESPONSES: Record<number, readonly number[]> = {
  [InteractionType.Ping]: [InteractionResponseType.Pong],
  [InteractionType.ApplicationCommand]: [
    InteractionResponseType.ChannelMessageWithSource,
    InteractionResponseType.DeferredChannelMessageWithSource,
    InteractionResponseType.Modal,
  ],
  [InteractionType.MessageComponent]: [
    InteractionResponseType.ChannelMessageWithSource,
    InteractionResponseType.DeferredChannelMessageWithSource,
    InteractionResponseType.DeferredMessageUpdate,
    InteractionResponseType.UpdateMessage,
    InteractionResponseType.Modal,
  ],
  [InteractionType.ApplicationCommandAutocomplete]: [
    InteractionResponseType.ApplicationCommandAutocompleteResult,
  ],
  [InteractionType.ModalSubmit]: [
    InteractionResponseType.ChannelMessageWithSource,
    InteractionResponseType.DeferredChannelMessageWithSource,
    InteractionResponseType.DeferredMessageUpdate,
    InteractionResponseType.UpdateMessage,
  ],
};

/**
 * Checks an interaction response against the interaction it answers: the
 * callback type must be one Discord accepts for that interaction type, and
 * its data must pass the message or modal rules.
 */
export function validateInteractionResponse(
  interactionType: number,
  response: unknown,
): Violation[] {
  const o = isObject(response) ? response : {};
  const type = o.type;
  const allowed = ALLOWED_RESPONSES[interactionType] ?? [];
  if (typeof type !== "number" || !allowed.includes(type)) {
    return [
      {
        rule: RULES.responseType,
        path: "type",
        detail: `callback type ${String(type)} is not a valid answer to interaction type ${String(interactionType)}; allowed: ${allowed.join(", ")}`,
      },
    ];
  }
  switch (type) {
    case InteractionResponseType.ChannelMessageWithSource:
    case InteractionResponseType.UpdateMessage:
      return validateMessage(o.data ?? {}).map((v) => ({
        ...v,
        path: `data.${v.path}`,
      }));
    case InteractionResponseType.DeferredChannelMessageWithSource: {
      const data = isObject(o.data) ? o.data : {};
      const extra = Object.keys(data).filter((key) => key !== "flags");
      const flags = typeof data.flags === "number" ? data.flags : 0;
      if (extra.length > 0 || (flags & ~MessageFlags.Ephemeral) !== 0) {
        return [
          {
            rule: RULES.deferredFlags,
            path: "data",
            detail: `a deferred response may carry only flags: 64; it has ${JSON.stringify(data)}`,
          },
        ];
      }
      return [];
    }
    case InteractionResponseType.DeferredMessageUpdate:
    case InteractionResponseType.Pong:
      return o.data === undefined
        ? []
        : [
            {
              rule: RULES.responseType,
              path: "data",
              detail: `callback type ${String(type)} carries no data`,
            },
          ];
    case InteractionResponseType.Modal:
      return validateModal(o.data).map((v) => ({
        ...v,
        path: `data.${v.path}`,
      }));
    default:
      return [];
  }
}
