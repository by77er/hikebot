/**
 * The location vote: an admin starts it from the panel with optional
 * initial locations, members propose more while it runs, and the shared
 * poll UI (`poll-ui.ts`) does the voting, refreshing and closing.
 */
import {
  ButtonStyle,
  TextInputStyle,
  type APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { discordApi } from "../discord/api";
import {
  button,
  customId,
  label,
  messageBody,
  modal,
  parseCustomId,
  textInput,
  textInputValue,
} from "../discord/components";
import { ephemeralNotice } from "../discord/responses";
import { setupComplete } from "../guild/config";
import { adminOnly } from "../guild/permissions";
import {
  UNAVAILABLE_MESSAGE,
  type ComponentHandler,
  type ModalHandler,
  type Router,
} from "../guild/router";
import { isPollError } from "../polls/errors";
import {
  MAX_DETAILS_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_OPTIONS,
  PollStore,
  labelKey,
  type PollView,
} from "../polls/store";
import {
  POLL_CONTROL_IDS,
  adminPanelUpdate,
  listing,
  missingSettings,
} from "./admin-panel";
import {
  VOTE_CLOSED_MESSAGE,
  deferPanel,
  errorText,
  finishPanel,
  renderPollMessage,
  scheduleRefresh,
  type PollWording,
} from "./poll-ui";

export const LOCATION_IDS = {
  start: POLL_CONTROL_IDS.startLocationVote,
  initial: customId("location", "initial"),
  propose: (pollId: number) => customId("location", "propose", String(pollId)),
  name: customId("location", "name"),
  details: customId("location", "details"),
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

function setupMissing(missing: string[]): string {
  return `Set the ${listing(missing)} under Settings before starting a vote.`;
}

/** Start location vote: opens the modal for the initial locations. */
const openStartModal: ComponentHandler = adminOnly(
  (_interaction, context, settings) => {
    if (!setupComplete(settings)) {
      return adminPanelUpdate(context, setupMissing(missingSettings(settings)));
    }
    if (new PollStore(context.storage).getActiveRound() !== null) {
      return adminPanelUpdate(context, "A round is already active.");
    }
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
  },
);

/**
 * The start modal: starts the round with the initial locations, then in
 * the follow-up posts the poll message in the voting channel and records
 * it. If Discord refuses the post, the round is cancelled again and the
 * panel says which channel and why.
 */
const startLocationVote: ModalHandler = adminOnly(
  (interaction: APIModalSubmitInteraction, context, settings) => {
    const parsed = parseInitialLocations(
      textInputValue(interaction.data, LOCATION_IDS.initial) ?? "",
    );
    if (!parsed.ok) return { response: ephemeralNotice(parsed.error) };
    const channelId = settings.voteChannelId;
    if (!setupComplete(settings) || channelId === null) {
      return {
        response: ephemeralNotice(setupMissing(missingSettings(settings))),
      };
    }
    const userId = interaction.member?.user.id ?? "";
    const store = new PollStore(context.storage);
    let poll: PollView | null;
    try {
      poll = store.startRound(
        userId,
        parsed.labels.map((labelText) => ({
          label: labelText,
          proposedBy: userId,
        })),
      ).locationPoll;
    } catch (error) {
      if (isPollError(error, "round_active")) {
        return { response: ephemeralNotice("A round is already active.") };
      }
      if (isPollError(error)) {
        return { response: ephemeralNotice(error.message) };
      }
      throw error;
    }
    if (poll === null) throw new Error("startRound returned no location poll");
    const started = poll;
    return {
      response: deferPanel(interaction),
      followUp: async () => {
        let notice: string;
        try {
          const message = await discordApi(context.env).createMessage(
            channelId,
            messageBody(renderPollMessage(started, LOCATION_POLL)),
          );
          store.setPollMessage(started.id, channelId, message.id);
          notice = `The location vote is open in <#${channelId}>.`;
        } catch (error) {
          store.cancelRound(started.roundId, userId);
          notice = `Could not post the location vote in <#${channelId}>: ${errorText(error)}. No round was started; check the bot's permissions in that channel and try again.`;
        }
        await finishPanel(context, interaction, notice);
      },
    };
  },
);

function pollIdArg(customIdValue: string): number | null {
  const id = Number(parseCustomId(customIdValue)?.arg);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const TOO_MANY = `This vote already has ${String(MAX_OPTIONS)} locations, the most it can hold. Vote for one of them instead.`;

/** Propose a location: opens the modal, unless the poll is closed or full. */
const openProposeModal: ComponentHandler = (interaction, context) => {
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
  return {
    response: modal(LOCATION_IDS.propose(poll.id), "Propose a location", [
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
    ]),
  };
};

/** The propose modal: adds the option and refreshes the poll message. */
const saveProposal: ModalHandler = async (interaction, context) => {
  const pollId = pollIdArg(interaction.data.custom_id);
  if (pollId === null) {
    return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
  }
  const store = new PollStore(context.storage);
  const name = textInputValue(interaction.data, LOCATION_IDS.name) ?? "";
  try {
    const option = store.addOption(pollId, {
      label: name,
      details: textInputValue(interaction.data, LOCATION_IDS.details) ?? null,
      proposedBy: interaction.member?.user.id ?? "",
    });
    await scheduleRefresh(context.storage, pollId, store.now());
    return {
      response: ephemeralNotice(
        `Added **${option.label}** to the location vote. Use **Vote** to vote for it.`,
      ),
    };
  } catch (error) {
    if (isPollError(error)) {
      const messages: Partial<Record<string, string>> = {
        poll_closed: VOTE_CLOSED_MESSAGE,
        poll_not_found: UNAVAILABLE_MESSAGE,
        duplicate_option: `**${name.trim()}** is already on the list. Vote for it instead.`,
        too_many_options: TOO_MANY,
      };
      return {
        response: ephemeralNotice(messages[error.code] ?? error.message),
      };
    }
    throw error;
  }
};

/** Registers the location vote's start and propose controls. */
export function registerLocationVote(router: Router): Router {
  router.component(LOCATION_IDS.start, openStartModal);
  router.modal(LOCATION_IDS.start, startLocationVote);
  router.component("hb:location:propose", openProposeModal);
  router.modal("hb:location:propose", saveProposal);
  return router;
}
