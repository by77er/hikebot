/**
 * The location vote: an admin starts it from the panel with optional
 * initial locations (`startLocationVote` in `round-actions.ts`), members
 * propose more while it runs (new ones in a modal, or past ones again from
 * a select), and the shared poll UI (`poll-ui.ts`) does the voting,
 * refreshing and closing.
 */
import {
  ButtonStyle,
  ComponentType,
  TextInputStyle,
  type APIComponentInContainer,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
  type APIModalInteractionResponse,
  type APIModalSubmitInteraction,
} from "discord-api-types/v10";
import {
  MAX_SELECT_OPTIONS,
  actionRow,
  button,
  container,
  customId,
  ephemeralReply,
  label,
  modal,
  parseCustomId,
  stringSelect,
  textDisplay,
  textInput,
  textInputValue,
  update,
} from "../discord/components";
import { ephemeralNotice } from "../discord/responses";
import { adminOnly } from "../guild/permissions";
import {
  UNAVAILABLE_MESSAGE,
  type ComponentHandler,
  type HandlerContext,
  type HandlerResult,
  type ModalHandler,
  type Router,
} from "../guild/router";
import {
  isPollError,
  type PollError,
  type PollErrorCode,
} from "../polls/errors";
import {
  MAX_DETAILS_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_OPTIONS,
  PollStore,
  cooldownMessage,
  labelKey,
  type PastLocation,
  type PollView,
  type RestingLocation,
} from "../polls/store";
import { POLL_CONTROL_IDS, adminPanelUpdate } from "./admin-panel";
import { givenPlace, scheduleNewLookup } from "./locate";
import {
  VOTE_CLOSED_MESSAGE,
  actorOf,
  answerPanel,
  roundContext,
  scheduleRefresh,
  shorten,
  type PollWording,
} from "./poll-ui";
import { locationVoteRefusal, startLocationVote } from "./round-actions";

export const LOCATION_IDS = {
  start: POLL_CONTROL_IDS.startLocationVote,
  initial: customId("location", "initial"),
  propose: (pollId: number) => customId("location", "propose", String(pollId)),
  name: customId("location", "name"),
  details: customId("location", "details"),
  map: customId("location", "map"),
  again: (pollId: number) => customId("location", "again", String(pollId)),
  newLocation: (pollId: number) => customId("location", "new", String(pollId)),
} as const;

export const LOCATION_POLL: PollWording = {
  kind: "location",
  title: () => "Where should we hike?",
  instructions:
    "Vote for every location you would go to; you can change your votes until the vote closes.",
  empty: "No locations yet. Propose one with **Propose a location**.",
  noOptions: "There are no locations to vote for yet. Propose one first.",
  noun: "location",
  nouns: "locations",
  name: "location vote",
  showProposer: true,
  order: "votes",
  extraButtons: (poll) => [
    button({
      custom_id: LOCATION_IDS.propose(poll.id),
      label: "Propose a location",
      style: ButtonStyle.Secondary,
    }),
  ],
  announcement: "Hike location decided",
  announcementLines: () => [],
  closeSteps: [],
};

/** The initial locations an admin typed, or why they are refused. */
export type ParsedLocations =
  { ok: true; labels: string[] } | { ok: false; error: string };

/**
 * Reads the "Initial locations" field: one location per line, trimmed,
 * blank lines dropped and duplicates (as the poll core compares labels)
 * collapsed. Refuses a line over the label limit and more lines than a poll
 * holds.
 */
export function parseInitialLocations(text: string): ParsedLocations {
  const labels: string[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.length > MAX_LABEL_LENGTH) {
      return {
        ok: false,
        error: `Line ${String(i + 1)} is ${String(line.length)} characters long; a location can have at most ${String(MAX_LABEL_LENGTH)}. Shorten it and try again.`,
      };
    }
    const key = labelKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(line);
  }
  if (labels.length > MAX_OPTIONS) {
    return {
      ok: false,
      error: `You listed ${String(labels.length)} locations; a vote holds at most ${String(MAX_OPTIONS)}. Remove some and try again.`,
    };
  }
  return { ok: true, labels };
}

/**
 * Why the initial locations are refused when some of them rest after a
 * recent hike, naming each; null when none does.
 */
export function restingRefusal(
  labels: readonly string[],
  resting: readonly RestingLocation[],
): string | null {
  const refused = labels.flatMap((line) => {
    const found = resting.find((r) => r.key === labelKey(line));
    return found ? [`- ${cooldownMessage(found)}`] : [];
  });
  if (refused.length === 0) return null;
  const what = refused.length === 1 ? "this location" : "these locations";
  return `Nothing was started. Remove ${what} and try again:\n${refused.join("\n")}`;
}

/** Start location vote: opens the modal for the initial locations. */
const openStartModal: ComponentHandler = adminOnly((_interaction, context) => {
  const refusal = locationVoteRefusal(context);
  if (refusal !== null) return adminPanelUpdate(context, refusal.message);
  return {
    response: modal(LOCATION_IDS.start, "Start location vote", [
      label(
        "Initial locations (one per line)",
        textInput({
          custom_id: LOCATION_IDS.initial,
          style: TextInputStyle.Paragraph,
          required: false,
          max_length: 4000,
          placeholder: "Leave empty to let members propose them",
        }),
        `Up to ${String(MAX_OPTIONS)}, each up to ${String(MAX_LABEL_LENGTH)} characters. Members can propose more.`,
      ),
    ]),
  };
});

/**
 * The start modal: starts the round with `startLocationVote` on the typed
 * lines, then in the follow-up posts the poll message and redraws the
 * panel. A refusal is answered ephemerally.
 */
const submitStart: ModalHandler = adminOnly(
  (interaction: APIModalSubmitInteraction, context) =>
    answerPanel(
      interaction,
      context,
      startLocationVote(
        roundContext(interaction, context),
        actorOf(interaction),
        {
          labels: (
            textInputValue(interaction.data, LOCATION_IDS.initial) ?? ""
          ).split(/\r?\n/),
        },
      ),
      (message) => ({ response: ephemeralNotice(message) }),
    ),
);

function pollIdArg(customIdValue: string): number | null {
  const id = Number(parseCustomId(customIdValue)?.arg);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const TOO_MANY = `This vote already has ${String(MAX_OPTIONS)} locations, the most it can hold. Vote for one of them instead.`;

function added(labelText: string): string {
  return `Added **${labelText}** to the location vote. Use **Vote** to vote for it.`;
}

/** The answer to a refused proposal of `name`, typed or picked. */
function proposalRefusal(error: PollError, name: string): string {
  const messages: Partial<Record<PollErrorCode, string>> = {
    poll_closed: VOTE_CLOSED_MESSAGE,
    poll_not_found: UNAVAILABLE_MESSAGE,
    duplicate_option: `**${name}** is already on the list. Vote for it instead.`,
    too_many_options: TOO_MANY,
  };
  return messages[error.code] ?? error.message;
}

function userIdOf(interaction: APIMessageComponentInteraction): string {
  return interaction.member?.user.id ?? interaction.user?.id ?? "";
}

/** The past locations a member can put on the poll again, at most 25. */
export function suggestable(past: readonly PastLocation[]): PastLocation[] {
  return past
    .filter((p) => !p.onPoll && p.cooldownHikesLeft === 0)
    .slice(0, MAX_SELECT_OPTIONS);
}

function hikesLeft(n: number): string {
  return n === 1 ? "1 more hike" : `${String(n)} more hikes`;
}

/**
 * The ephemeral "suggest again" message: `notice` (or what it is for), the
 * select of past locations that are neither on the poll nor resting, the
 * New location button, and one line naming the resting locations, the
 * most recent hike first.
 */
export function renderSuggestAgain(
  pollId: number,
  past: readonly PastLocation[],
  notice?: string,
): APIMessageTopLevelComponent[] {
  const offer = suggestable(past);
  const resting = past
    .filter((p) => p.cooldownHikesLeft > 0)
    .sort((a, b) => b.cooldownHikesLeft - a.cooldownHikesLeft);
  const body: APIComponentInContainer[] = [
    textDisplay(
      notice ??
        "**Propose a location**\nPut one from an earlier round on the vote again, or add a new one.",
    ),
  ];
  if (offer.length > 0) {
    body.push(
      actionRow(
        stringSelect({
          custom_id: LOCATION_IDS.again(pollId),
          placeholder: "Suggest one again",
          options: offer.map((p) => ({
            label: p.label,
            value: String(p.optionId),
            ...(p.details === null
              ? {}
              : { description: shorten(p.details, 100) }),
          })),
        }),
      ),
    );
  }
  body.push(
    actionRow(
      button({
        custom_id: LOCATION_IDS.newLocation(pollId),
        label: "New location",
        style: ButtonStyle.Secondary,
      }),
    ),
  );
  if (resting.length > 0) {
    const names = resting.map(
      (p) => `**${p.label}** (${hikesLeft(p.cooldownHikesLeft)})`,
    );
    body.push(textDisplay(`Resting: ${names.join(", ")}`));
  }
  return [container(body)];
}

/** The longest map link or coordinates the propose modal takes. */
const MAX_MAP_INPUT = 1000;

function proposeModal(pollId: number): APIModalInteractionResponse {
  return modal(LOCATION_IDS.propose(pollId), "Propose a location", [
    label(
      "Name",
      textInput({
        custom_id: LOCATION_IDS.name,
        max_length: MAX_LABEL_LENGTH,
        placeholder: "Ridge Trail",
      }),
    ),
    label(
      "Details",
      textInput({
        custom_id: LOCATION_IDS.details,
        style: TextInputStyle.Paragraph,
        required: false,
        max_length: MAX_DETAILS_LENGTH,
      }),
      "Optional: a trail link, the distance, notes",
    ),
    label(
      "Map link or coordinates",
      textInput({
        custom_id: LOCATION_IDS.map,
        required: false,
        max_length: MAX_MAP_INPUT,
        placeholder: "47.4875, -121.7234",
      }),
      "Optional: a Google Maps, OpenStreetMap or Apple Maps link, or lat, lon",
    ),
  ]);
}

/** The poll a proposal control is for, or the answer refusing it. */
function proposablePoll(
  interaction: APIMessageComponentInteraction,
  context: HandlerContext,
): { poll: PollView } | HandlerResult {
  const pollId = pollIdArg(interaction.data.custom_id);
  const poll =
    pollId === null ? null : new PollStore(context.storage).getPoll(pollId);
  if (!poll || poll.kind !== "location") {
    return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
  }
  if (poll.status !== "open") {
    return { response: ephemeralNotice(VOTE_CLOSED_MESSAGE) };
  }
  if (poll.options.length >= MAX_OPTIONS) {
    return { response: ephemeralNotice(TOO_MANY) };
  }
  return { poll };
}

/**
 * Propose a location: the suggest-again message when a past location can
 * go on the poll again, else the modal; refused when the poll is closed or
 * full.
 */
const openPropose: ComponentHandler = (interaction, context) => {
  const found = proposablePoll(interaction, context);
  if (!("poll" in found)) return found;
  const past = new PollStore(context.storage).listPastLocations(
    userIdOf(interaction),
    found.poll.id,
  );
  if (suggestable(past).length === 0) {
    return { response: proposeModal(found.poll.id) };
  }
  return { response: ephemeralReply(renderSuggestAgain(found.poll.id, past)) };
};

/** New location: the modal, unless the poll is closed or full. */
const openProposeModal: ComponentHandler = (interaction, context) => {
  const found = proposablePoll(interaction, context);
  if (!("poll" in found)) return found;
  return { response: proposeModal(found.poll.id) };
};

/**
 * The suggest-again select: adds the picked past location with its saved
 * label and details and the member as proposer, refreshes the poll message,
 * and confirms in place with a fresh select. A refusal gets the answer a
 * typed proposal gets.
 */
const pickPastLocation: ComponentHandler = async (interaction, context) => {
  const pollId = pollIdArg(interaction.data.custom_id);
  const picked =
    interaction.data.component_type === ComponentType.StringSelect
      ? Number(interaction.data.values[0])
      : NaN;
  const store = new PollStore(context.storage);
  const source = Number.isSafeInteger(picked) ? store.getOption(picked) : null;
  if (
    pollId === null ||
    source === null ||
    store.getPoll(source.pollId)?.kind !== "location"
  ) {
    return { response: update([textDisplay(UNAVAILABLE_MESSAGE)]) };
  }
  const userId = userIdOf(interaction);
  let notice: string;
  try {
    const option = store.addOption(pollId, {
      label: source.label,
      details: source.details,
      proposedBy: userId,
      ...(source.place === null ? {} : { place: source.place }),
    });
    await scheduleRefresh(context.storage, pollId, store.now());
    await scheduleNewLookup(context.storage, store, store.now());
    notice = added(option.label);
  } catch (error) {
    if (!isPollError(error)) throw error;
    notice = proposalRefusal(error, source.label);
  }
  const poll = store.getPoll(pollId);
  if (
    !poll ||
    poll.kind !== "location" ||
    poll.status !== "open" ||
    poll.options.length >= MAX_OPTIONS
  ) {
    return { response: update([textDisplay(notice)]) };
  }
  return {
    response: update(
      renderSuggestAgain(
        poll.id,
        store.listPastLocations(userId, poll.id),
        notice,
      ),
    ),
  };
};

/**
 * The propose modal: adds the option, with the coordinates written in its
 * map field, name or details if any, and refreshes the poll message.
 * Without coordinates the option is looked up later by the `geo:locate`
 * job; a map field that holds none is said so in the answer.
 */
const saveProposal: ModalHandler = async (interaction, context) => {
  const pollId = pollIdArg(interaction.data.custom_id);
  if (pollId === null) {
    return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
  }
  const store = new PollStore(context.storage);
  const name = textInputValue(interaction.data, LOCATION_IDS.name) ?? "";
  const details = textInputValue(interaction.data, LOCATION_IDS.details);
  const map = textInputValue(interaction.data, LOCATION_IDS.map)?.trim();
  const place = givenPlace([map, name, details]);
  try {
    const option = store.addOption(pollId, {
      label: name,
      details: details ?? null,
      proposedBy: interaction.member?.user.id ?? "",
      ...(place === undefined ? {} : { place }),
    });
    await scheduleRefresh(context.storage, pollId, store.now());
    await scheduleNewLookup(context.storage, store, store.now());
    const unread =
      map && givenPlace([map]) === undefined
        ? ` The map field holds no coordinates I can read (short links are not opened), so the location will be looked up by its name; an admin can set its pin if it wins.`
        : "";
    return { response: ephemeralNotice(`${added(option.label)}${unread}`) };
  } catch (error) {
    if (isPollError(error)) {
      return { response: ephemeralNotice(proposalRefusal(error, name.trim())) };
    }
    throw error;
  }
};

/** Registers the location vote's start and propose controls. */
export function registerLocationVote(router: Router): Router {
  router.component(LOCATION_IDS.start, openStartModal);
  router.modal(LOCATION_IDS.start, submitStart);
  router.component("hb:location:propose", openPropose);
  router.component("hb:location:new", openProposeModal);
  router.component("hb:location:again", pickPastLocation);
  router.modal("hb:location:propose", saveProposal);
  return router;
}
