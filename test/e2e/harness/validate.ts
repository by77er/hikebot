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

const DOCS = "https://docs.discord.com/developers";
const COMPONENTS_REFERENCE = `${DOCS}/components/reference`;
const USING_COMPONENTS = `${DOCS}/components/using-message-components#sending-a-message-with-a-component`;
const CREATE_MESSAGE = `${DOCS}/resources/message#create-message`;
const RESPONDING = `${DOCS}/interactions/receiving-and-responding`;
const START_FORUM_THREAD = `${DOCS}/resources/channel#start-thread-in-forum-or-media-channel`;
const COMMANDS = `${DOCS}/interactions/application-commands`;
const SCHEDULED_EVENTS = `${DOCS}/resources/guild-scheduled-event`;
const CREATE_SCHEDULED_EVENT = `${SCHEDULED_EVENTS}#create-guild-scheduled-event`;
const SCHEDULED_EVENT_OBJECT = `${SCHEDULED_EVENTS}#guild-scheduled-event-object-guild-scheduled-event-structure`;
const EVENT_FIELD_REQUIREMENTS = `${SCHEDULED_EVENTS}#guild-scheduled-event-object-field-requirements-by-entity-type`;
const EVENT_METADATA = `${SCHEDULED_EVENTS}#guild-scheduled-event-object-guild-scheduled-event-entity-metadata`;
const EVENT_PERMISSIONS = `${SCHEDULED_EVENTS}#guild-scheduled-event-permissions-requirements`;
const OAUTH2 = `${DOCS}/topics/oauth2`;
const AUTHORIZATION_CODE_GRANT = `${OAUTH2}#authorization-code-grant`;
const CURRENT_USER_GUILDS = `${DOCS}/resources/user#get-current-user-guilds`;

/** A rule the fake enforces. `docs` is where the limit is stated. */
export interface Rule {
  id: string;
  docs: string;
}

function rule(id: string, docs: string): Rule {
  return { id, docs };
}

/** Each rule quotes the page `docs` points to. */
export const RULES = {
  /**
   * "Providing `content`, `embeds`, `sticker_ids`, `poll`, or
   * `shared_client_theme` will fail with a 400 BAD REQUEST response."
   */
  v2NoContentOrEmbeds: rule(
    "components-v2-no-content-or-embeds",
    CREATE_MESSAGE,
  ),
  /** Text Display, Section, Container and the like need IS_COMPONENTS_V2. */
  v2FlagRequired: rule(
    "components-v2-flag-required",
    `${COMPONENTS_REFERENCE}#text-display`,
  ),
  /** "Setting the `IS_COMPONENTS_V2` message flag cannot be reverted." */
  v2FlagPermanent: rule("components-v2-flag-permanent", USING_COMPONENTS),
  /** "Messages allow up to 40 total components." */
  maxComponents: rule("message-max-40-components", COMPONENTS_REFERENCE),
  /**
   * "The amount of text across all text display components cannot exceed
   * 4000 characters." Discord's own pages do not state this cap; the
   * discord.js guide does, and Discord's API enforces it.
   */
  maxText: rule(
    "message-max-4000-text-characters",
    "https://discordjs.guide/legacy/popular-topics/display-components",
  ),
  /** "Message contents (up to 2000 characters)". */
  maxContent: rule("message-content-max-2000", CREATE_MESSAGE),
  /** "Up to 5 interactive button components or a single select component". */
  actionRow: rule(
    "action-row-5-buttons-or-1-select",
    `${COMPONENTS_REFERENCE}#action-row`,
  ),
  /** "One to three child components", and an accessory. */
  section: rule("section-contents", `${COMPONENTS_REFERENCE}#section`),
  /** "Specified choices in a select menu; max 25". */
  selectOptions: rule(
    "select-1-to-25-options",
    `${COMPONENTS_REFERENCE}#string-select`,
  ),
  /**
   * `min_values`: "defaults to 1); min 0 ..., max 25"; `max_values`:
   * "(defaults to 1); max 25".
   */
  selectValues: rule(
    "select-min-max-values",
    `${COMPONENTS_REFERENCE}#string-select`,
  ),
  /** "Placeholder text if nothing is selected or default; max 150 characters". */
  selectPlaceholder: rule(
    "select-placeholder-max-150",
    `${COMPONENTS_REFERENCE}#string-select`,
  ),
  /** Option `label`, `value` and `description`: "max 100 characters". */
  selectOptionText: rule(
    "select-option-text-max-100",
    `${COMPONENTS_REFERENCE}#string-select-select-option-structure`,
  ),
  /** "Text that appears on the button; max 80 characters". */
  buttonLabel: rule("button-label-max-80", `${COMPONENTS_REFERENCE}#button`),
  /** Link buttons carry a url and no custom_id; other buttons a custom_id. */
  buttonTarget: rule(
    "button-custom-id-or-url",
    `${COMPONENTS_REFERENCE}#button`,
  ),
  /** custom_id: "This field is a string of 1 to 100 characters". */
  customIdLength: rule("custom-id-1-to-100-characters", COMPONENTS_REFERENCE),
  /** "Multiple components on the same message must not share the same `custom_id`." */
  customIdUnique: rule("custom-id-unique-in-message", COMPONENTS_REFERENCE),
  /** "Title of the popup modal, max 45 characters". */
  modalTitle: rule("modal-title-max-45", `${RESPONDING}#modal`),
  /** "Between 1 and 5 (inclusive) components that make up the modal". */
  modalComponents: rule("modal-1-to-5-components", `${RESPONDING}#modal`),
  /** "The label text; max 45 characters"; description "max 100 characters". */
  labelText: rule("label-text-max-45", `${COMPONENTS_REFERENCE}#label`),
  /** min_length 0-4000, max_length 1-4000, value max 4000, placeholder max 100. */
  textInput: rule("text-input-limits", `${COMPONENTS_REFERENCE}#text-input`),
  /** "1-100 character channel name". */
  threadName: rule("thread-name-1-to-100", START_FORUM_THREAD),
  /** "Creates a new thread in a forum or a media channel." */
  forumOnly: rule("forum-thread-needs-forum-channel", START_FORUM_THREAD),
  /**
   * Which callback types each interaction type accepts: UPDATE_MESSAGE and
   * DEFERRED_UPDATE_MESSAGE only for components and modals opened from one,
   * MODAL "Not available for `MODAL_SUBMIT` and `PING` interactions."
   */
  responseType: rule(
    "interaction-response-type",
    `${RESPONDING}#interaction-response-object-interaction-callback-type`,
  ),
  /**
   * A message response: "only `SUPPRESS_EMBEDS`, `EPHEMERAL`,
   * `IS_COMPONENTS_V2`, `IS_VOICE_MESSAGE`, and `SUPPRESS_NOTIFICATIONS` can
   * be set"; a deferred one carries only `EPHEMERAL`.
   */
  responseFlags: rule(
    "interaction-response-flags",
    `${RESPONDING}#interaction-response-object-interaction-callback-data-structure`,
  ),
  /** Chat input command names: 1-32 lowercase letters, digits, - or _. */
  commandName: rule(
    "command-name",
    `${COMMANDS}#application-command-object-application-command-naming`,
  ),
  /** Chat input command descriptions: 1-100 characters. */
  commandDescription: rule(
    "command-description-1-to-100",
    `${COMMANDS}#application-command-object-application-command-structure`,
  ),
  /**
   * Create Guild Scheduled Event's JSON Params list `name`,
   * `privacy_level`, `scheduled_start_time` ("ISO8601 timestamp") and
   * `entity_type` without "?", so each is required; privacy level
   * "GUILD_ONLY | 2" is the only one, and entity types are 1, 2 and 3.
   */
  eventRequired: rule(
    "scheduled-event-required-fields",
    CREATE_SCHEDULED_EVENT,
  ),
  /** name: "the name of the scheduled event (1-100 characters)". */
  eventName: rule("scheduled-event-name-1-to-100", SCHEDULED_EVENT_OBJECT),
  /** description: "the description of the scheduled event (1-1000 characters)". */
  eventDescription: rule(
    "scheduled-event-description-1-to-1000",
    SCHEDULED_EVENT_OBJECT,
  ),
  /** location: "location of the event (1-100 characters)". */
  eventLocation: rule("scheduled-event-location-1-to-100", EVENT_METADATA),
  /**
   * scheduled_end_time: "the time the scheduled event will end, required if
   * entity_type is EXTERNAL".
   */
  externalEventEnd: rule(
    "external-event-needs-end-time",
    EVENT_FIELD_REQUIREMENTS,
  ),
  /**
   * For EXTERNAL: "`entity_metadata` with a non-null `location` must be
   * provided".
   */
  externalEventLocation: rule(
    "external-event-needs-location",
    EVENT_FIELD_REQUIREMENTS,
  ),
  /**
   * channel_id: "the channel id in which the scheduled event will be
   * hosted, or null if scheduled entity type is EXTERNAL".
   */
  externalEventChannel: rule(
    "external-event-has-no-channel",
    EVENT_FIELD_REQUIREMENTS,
  ),
  /**
   * "A guild can have a maximum of 100 events with `SCHEDULED` or `ACTIVE`
   * status at any time." Discord answers code 30038, "Maximum number of
   * uncompleted guild scheduled events reached (100)".
   */
  maxScheduledEvents: rule(
    "guild-max-100-scheduled-events",
    CREATE_SCHEDULED_EVENT,
  ),
  /**
   * To create an EXTERNAL event, "The user's guild-level permissions must
   * include: CREATE_EVENTS". Discord answers 403, code 50013.
   */
  createEventsPermission: rule(
    "scheduled-event-needs-create-events",
    EVENT_PERMISSIONS,
  ),
  /**
   * The authorization URL takes "`response_type`: `code`" for the
   * authorization code grant.
   */
  oauthResponseType: rule(
    "oauth2-response-type-code",
    AUTHORIZATION_CODE_GRANT,
  ),
  /**
   * "All calls to the OAuth2 endpoints require either HTTP Basic
   * authentication or `client_id` and `client_secret` supplied in the form
   * data body." The authorize page also needs the application's `client_id`.
   */
  oauthClientCredentials: rule(
    "oauth2-client-credentials",
    AUTHORIZATION_CODE_GRANT,
  ),
  /**
   * `redirect_uri` is "whatever URL you registered when creating your
   * application, url-encoded"; Discord shows "Invalid OAuth2 redirect_uri"
   * for any other.
   */
  oauthRegisteredRedirectUri: rule(
    "oauth2-redirect-uri-registered",
    AUTHORIZATION_CODE_GRANT,
  ),
  /**
   * The token URL "will **only** accept a content type of
   * `application/x-www-form-urlencoded`."
   */
  oauthFormBody: rule("oauth2-form-body", AUTHORIZATION_CODE_GRANT),
  /** `grant_type` "must be set to `authorization_code`". */
  oauthGrantType: rule("oauth2-grant-type", AUTHORIZATION_CODE_GRANT),
  /**
   * "The client MUST NOT use the authorization code more than once" (RFC
   * 6749, which Discord's OAuth2 implements). Discord's own pages do not
   * state this; its token URL answers `invalid_grant` to a code it did not
   * issue or already exchanged.
   */
  oauthCodeSingleUse: rule(
    "oauth2-code-used-once",
    "https://www.rfc-editor.org/rfc/rfc6749#section-4.1.2",
  ),
  /**
   * The exchange's `redirect_uri` is "the `redirect_uri` associated with
   * this authorization, usually from your authorization URL".
   */
  oauthRedirectUriMatches: rule(
    "oauth2-redirect-uri-matches",
    AUTHORIZATION_CODE_GRANT,
  ),
  /** `limit`: "max number of guilds to return (1-200)". */
  currentUserGuildsLimit: rule(
    "current-user-guilds-limit-1-200",
    CURRENT_USER_GUILDS,
  ),
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
    .map(
      (v) =>
        `${v.rule.id} at ${v.path || "(root)"}: ${v.detail} (${v.rule.docs})`,
    )
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
      this.fail(
        rule,
        path,
        `is ${String(s.length)} characters, max ${String(max)}`,
      );
    } else if (s.length < min) {
      this.fail(
        rule,
        path,
        `is ${String(s.length)} characters, min ${String(min)}`,
      );
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

const COMPONENT_TYPES = new Map<number, ComponentType>(
  Object.values(ComponentType)
    .filter((type): type is ComponentType => typeof type === "number")
    .map((type) => [type, type]),
);

function componentType(value: number): ComponentType | undefined {
  return COMPONENT_TYPES.get(value);
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
  const type = componentType(component.type);
  if (!v2 && type !== undefined && V2_ONLY_TYPES.has(type)) {
    c.fail(
      RULES.v2FlagRequired,
      path,
      `component type ${String(component.type)} needs the IS_COMPONENTS_V2 flag (32768)`,
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
          (child) =>
            isObject(child) && child.type === ComponentType.TextDisplay,
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
    switch (o.type as ComponentType) {
      case ComponentType.Label: {
        c.maxLength(RULES.labelText, `${path}.label`, o.label, 45, 1);
        c.maxLength(RULES.labelText, `${path}.description`, o.description, 100);
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
    if (
      min !== undefined &&
      (typeof min !== "number" || min < 0 || min > 4000)
    ) {
      c.fail(RULES.textInput, `${path}.min_length`, "must be 0 to 4000");
    }
    if (
      max !== undefined &&
      (typeof max !== "number" || max < 1 || max > 4000)
    ) {
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
  parentType: ChannelType | undefined,
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

/** Checks the body of Create Guild Scheduled Event. */
export function validateScheduledEvent(body: unknown): Violation[] {
  const c = new Checker();
  const o = isObject(body) ? body : {};
  c.maxLength(RULES.eventName, "name", o.name, 100, 1);
  if (o.privacy_level !== 2) {
    c.fail(RULES.eventRequired, "privacy_level", "must be 2 (GUILD_ONLY)");
  }
  const start = text(o.scheduled_start_time);
  if (start === undefined || Number.isNaN(Date.parse(start))) {
    c.fail(
      RULES.eventRequired,
      "scheduled_start_time",
      "must be an ISO8601 timestamp",
    );
  }
  if (o.entity_type !== 1 && o.entity_type !== 2 && o.entity_type !== 3) {
    c.fail(RULES.eventRequired, "entity_type", "must be 1, 2 or 3");
  }
  if (o.description !== undefined && o.description !== null) {
    c.maxLength(RULES.eventDescription, "description", o.description, 1000, 1);
  }
  const metadata = isObject(o.entity_metadata) ? o.entity_metadata : {};
  if (metadata.location !== undefined && metadata.location !== null) {
    c.maxLength(
      RULES.eventLocation,
      "entity_metadata.location",
      metadata.location,
      100,
      1,
    );
  }
  if (o.entity_type === 3) {
    const end = text(o.scheduled_end_time);
    if (end === undefined || Number.isNaN(Date.parse(end))) {
      c.fail(
        RULES.externalEventEnd,
        "scheduled_end_time",
        "is required for an EXTERNAL event",
      );
    }
    if (typeof metadata.location !== "string") {
      c.fail(
        RULES.externalEventLocation,
        "entity_metadata.location",
        "is required for an EXTERNAL event",
      );
    }
    if (o.channel_id !== undefined && o.channel_id !== null) {
      c.fail(
        RULES.externalEventChannel,
        "channel_id",
        "must be null or left out for an EXTERNAL event",
      );
    }
  }
  return c.violations;
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

const ALLOWED_RESPONSES: Record<number, readonly InteractionResponseType[]> = {
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

const UPDATES: readonly InteractionResponseType[] = [
  InteractionResponseType.DeferredMessageUpdate,
  InteractionResponseType.UpdateMessage,
];

/** Flags a message response may set. */
const RESPONSE_FLAGS =
  MessageFlags.SuppressEmbeds |
  MessageFlags.Ephemeral |
  MessageFlags.IsComponentsV2 |
  MessageFlags.IsVoiceMessage |
  MessageFlags.SuppressNotifications;

/** The interaction a response answers, as far as the rules need it. */
export interface AnsweredInteraction {
  type: InteractionType;
  /** The message a component (or a modal opened from one) sits on. */
  message?: { flags?: number };
}

/**
 * Checks an interaction response against the interaction it answers: the
 * callback type must be one Discord accepts for that interaction, and its
 * data must pass the message or modal rules.
 */
export function validateInteractionResponse(
  interaction: AnsweredInteraction,
  response: unknown,
): Violation[] {
  const o = isObject(response) ? response : {};
  const allowed = (ALLOWED_RESPONSES[interaction.type] ?? []).filter(
    (type) =>
      !UPDATES.includes(type) ||
      interaction.type === InteractionType.MessageComponent ||
      interaction.message !== undefined,
  );
  const type = allowed.find((t) => t === o.type);
  if (type === undefined) {
    const why =
      interaction.type === InteractionType.ModalSubmit &&
      interaction.message === undefined &&
      typeof o.type === "number" &&
      (UPDATES as readonly number[]).includes(o.type)
        ? "; the modal was not opened from a message, so there is no message to update"
        : "";
    return [
      {
        rule: RULES.responseType,
        path: "type",
        detail: `callback type ${String(o.type)} is not a valid answer to interaction type ${String(interaction.type)}${why}; allowed: ${allowed.join(", ")}`,
      },
    ];
  }
  const data = isObject(o.data) ? o.data : undefined;
  switch (type) {
    case InteractionResponseType.ChannelMessageWithSource:
    case InteractionResponseType.UpdateMessage: {
      const violations = validateMessage(
        data ?? {},
        type === InteractionResponseType.UpdateMessage
          ? { existingFlags: interaction.message?.flags ?? 0 }
          : {},
      );
      const flags = typeof data?.flags === "number" ? data.flags : 0;
      if ((flags & ~RESPONSE_FLAGS) !== 0) {
        violations.push({
          rule: RULES.responseFlags,
          path: "flags",
          detail: `sets ${String(flags & ~RESPONSE_FLAGS)}, which a message response cannot set`,
        });
      }
      return violations.map((v) => ({ ...v, path: `data.${v.path}` }));
    }
    case InteractionResponseType.DeferredChannelMessageWithSource: {
      const fields = data ?? {};
      const extra = Object.keys(fields).filter((key) => key !== "flags");
      const flags = typeof fields.flags === "number" ? fields.flags : 0;
      if (extra.length > 0 || (flags & ~MessageFlags.Ephemeral) !== 0) {
        return [
          {
            rule: RULES.responseFlags,
            path: "data",
            detail: `a deferred response may carry only flags: 64; it has ${JSON.stringify(fields)}`,
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
