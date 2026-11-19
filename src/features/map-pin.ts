/**
 * The decided location's map pin, which an admin can correct: **Set map
 * pin** (`hb:pin:set:<round id>`) in the panel opens a modal taking
 * coordinates or a map link (empty clears the pin), stores it as `given`,
 * then runs the map pin hooks, which bring what shows the hike up to date
 * (the hike thread's first message, the event's description). Other code
 * sets a pin with `setMapPin` and joins in with a `MapPinHook`.
 */
import type {
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
} from "discord-api-types/v10";
import {
  customId,
  label,
  modal,
  parseCustomId,
  textInput,
  textInputValue,
} from "../discord/components";
import { ephemeralNotice } from "../discord/responses";
import { GuildConfig } from "../guild/config";
import { adminOnly } from "../guild/permissions";
import type {
  ComponentHandler,
  HandlerContext,
  ModalHandler,
  Router,
} from "../guild/router";
import { parseCoordinates, type Point } from "../geo/coordinates";
import { formatPoint } from "../geo/links";
import { isPollError } from "../polls/errors";
import { PollStore, type OptionView, type RoundView } from "../polls/store";
import { POLL_CONTROL_IDS, adminPanelUpdate } from "./admin-panel";
import { recordMapPinMoved } from "./map-picture-state";
import { deferPanel, errorText, finishPanel } from "./poll-ui";
import type { ActionOutcome } from "./round-actions";

export const MAP_PIN_IDS = {
  set: POLL_CONTROL_IDS.setMapPin,
  point: customId("pin", "point"),
} as const;

/** The longest map link or coordinates the modal and the web form take. */
export const MAX_PIN_INPUT = 1000;

/** A changed pin, as the hooks get it. */
export interface MapPinChange {
  /** The round, read again after the pin was stored. */
  round: RoundView;
  /** The decided location, with its new place. */
  location: OptionView;
  guildId: string;
  /** The guild's time zone, for what shows the date. */
  timeZone: string;
}

/**
 * Work that follows a pin change, such as editing a message that shows the
 * location. A hook that throws is named in the notes with the error; the
 * others still run.
 */
export interface MapPinHook {
  /** What the hook does, for the panel when it fails: "update the hike thread". */
  name: string;
  run: (change: MapPinChange, context: HandlerContext) => Promise<void>;
}

/**
 * The round whose decided location can be pinned: the active round once
 * its location is decided, else the last round when it is complete.
 */
export function pinnableRound(store: PollStore): RoundView | null {
  const active = store.getActiveRound();
  const round = active ?? store.getLastRound();
  if (round === null || round.locationOptionId === null) return null;
  if (active === null && round.status !== "complete") return null;
  return round;
}

/** The decided location of `round`, if any. */
function decided(round: RoundView): OptionView | null {
  return (
    round.locationPoll?.options.find(
      (option) => option.id === round.locationOptionId,
    ) ?? null
  );
}

/**
 * Stores `point` (null clears it) as the pin of round `roundId`'s decided
 * location, noting that the map picture shown is of the old pin, and
 * returns the change for the hooks, or null when that round
 * is no longer the one whose pin can be set.
 */
export function storeMapPin(
  storage: DurableObjectStorage,
  roundId: number,
  point: Point | null,
  guildId: string,
  timeZone: string,
): MapPinChange | null {
  const store = new PollStore(storage);
  const round = pinnableRound(store);
  if (round === null || round.id !== roundId || !decided(round)) return null;
  try {
    store.setOptionPin(round.locationOptionId ?? 0, point);
  } catch (error) {
    if (isPollError(error)) return null;
    throw error;
  }
  // Until the hooks show the new pin's picture, the panel offers to.
  recordMapPinMoved(storage, round, store.now());
  const after = store.getRound(roundId);
  const location = after && decided(after);
  if (!after || !location) return null;
  return { round: after, location, guildId, timeZone };
}

/**
 * Runs each hook for `change`, in order, and returns a note for each one
 * that failed.
 */
export async function runMapPinHooks(
  change: MapPinChange,
  context: HandlerContext,
  hooks: readonly MapPinHook[],
): Promise<string[]> {
  const notes: string[] = [];
  for (const hook of hooks) {
    try {
      await hook.run(change, context);
    } catch (error) {
      notes.push(`Could not ${hook.name}: ${errorText(error)}.`);
    }
  }
  return notes;
}

/**
 * Sets the pin of round `roundId`'s decided location to `point` (null
 * clears it) and runs the hooks. Returns the change and the notes of hooks
 * that failed, or null when the round's pin cannot be set.
 */
export async function setMapPin(
  context: HandlerContext,
  pin: { roundId: number; point: Point | null; guildId: string },
  hooks: readonly MapPinHook[],
): Promise<{ change: MapPinChange; notes: string[] } | null> {
  const change = storeMapPin(
    context.storage,
    pin.roundId,
    pin.point,
    pin.guildId,
    new GuildConfig(context.storage).get().timezone,
  );
  if (change === null) return null;
  return { change, notes: await runMapPinHooks(change, context, hooks) };
}

/**
 * What was typed into Set map pin: a point, null when it is empty (which
 * removes the pin), or "unreadable" when no coordinates can be read from
 * it.
 */
export function readPinInput(typed: string): Point | null | "unreadable" {
  const trimmed = typed.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_PIN_INPUT) return "unreadable";
  return parseCoordinates(trimmed) ?? "unreadable";
}

/** The refusal of input with no coordinates in it. */
export const PIN_UNREADABLE =
  "No coordinates could be read from that, so the pin is unchanged. Enter `lat, lon` in decimal degrees such as `47.4875, -121.7234`, or paste a Google Maps, OpenStreetMap or Apple Maps link that shows the coordinates (short links such as maps.app.goo.gl are not opened). Leave it empty to remove the pin.";

/** The refusal of a round whose pin can no longer be set. */
export const PIN_NOT_PINNABLE =
  "That hike's location can no longer be pinned from here.";

/** What Set map pin says it did, in the panel's words. */
export function pinDone(change: MapPinChange, point: Point | null): string {
  return point === null
    ? `The map pin of **${change.location.label}** is removed.`
    : `The map pin of **${change.location.label}** is set to ${formatPoint(point)}.`;
}

/**
 * Set map pin as a round action, for the web page's admin control: reads
 * `input` as the panel's modal does and stores the pin of round
 * `roundId`'s decided location before it returns; its work runs `hooks`
 * and resolves to the panel's notes. The caller checks that the actor is
 * an admin.
 */
export function setMapPinAction(
  context: HandlerContext & { guildId: string },
  pin: { roundId: number; input: string },
  hooks: readonly MapPinHook[],
): ActionOutcome<"unreadable" | "not_pinnable", { change: MapPinChange }> {
  const point = readPinInput(pin.input);
  if (point === "unreadable") {
    return { ok: false, code: "unreadable", message: PIN_UNREADABLE };
  }
  const change = storeMapPin(
    context.storage,
    pin.roundId,
    point,
    context.guildId,
    new GuildConfig(context.storage).get().timezone,
  );
  if (change === null) {
    return { ok: false, code: "not_pinnable", message: PIN_NOT_PINNABLE };
  }
  return {
    ok: true,
    change,
    work: async () => [
      pinDone(change, point),
      ...(await runMapPinHooks(change, context, hooks)),
    ],
  };
}

const NOT_PINNABLE = `${PIN_NOT_PINNABLE} Refresh the panel.`;

function roundArg(interaction: { data: { custom_id: string } }): number {
  return Number(parseCustomId(interaction.data.custom_id)?.arg);
}

/** Set map pin: the modal, prefilled with the current pin. */
const openPinModal: ComponentHandler = adminOnly(
  (interaction: APIMessageComponentInteraction, context) => {
    const round = pinnableRound(new PollStore(context.storage));
    const location = round && decided(round);
    if (!round || !location || round.id !== roundArg(interaction)) {
      return adminPanelUpdate(context, NOT_PINNABLE);
    }
    const point = location.place?.point ?? null;
    return {
      response: modal(MAP_PIN_IDS.set(round.id), "Set map pin", [
        label(
          "Map link or coordinates",
          textInput({
            custom_id: MAP_PIN_IDS.point,
            required: false,
            max_length: MAX_PIN_INPUT,
            placeholder: "47.4875, -121.7234",
            ...(point === null ? {} : { value: formatPoint(point) }),
          }),
          "Leave it empty to remove the pin.",
        ),
      ]),
    };
  },
);

/**
 * The pin modal: refuses input it cannot read, else stores the pin before
 * answering and, in the follow-up, runs the hooks and redraws the panel.
 */
function savePin(hooks: readonly MapPinHook[]): ModalHandler {
  return adminOnly(
    (interaction: APIModalSubmitInteraction, context, settings) => {
      const point = readPinInput(
        textInputValue(interaction.data, MAP_PIN_IDS.point) ?? "",
      );
      if (point === "unreadable") {
        return { response: ephemeralNotice(PIN_UNREADABLE) };
      }
      const guildId = interaction.guild_id ?? "";
      const change = storeMapPin(
        context.storage,
        roundArg(interaction),
        point,
        guildId,
        settings.timezone,
      );
      if (change === null) return { response: ephemeralNotice(NOT_PINNABLE) };
      const done = pinDone(change, point);
      return {
        response: deferPanel(interaction),
        followUp: async () => {
          const notes = await runMapPinHooks(change, context, hooks);
          await finishPanel(context, interaction, [done, ...notes].join("\n"));
        },
      };
    },
  );
}

/** Registers Set map pin and its modal; `hooks` run after each change. */
export function registerMapPin(
  router: Router,
  hooks: readonly MapPinHook[],
): Router {
  router.component("hb:pin:set", openPinModal);
  router.modal("hb:pin:set", savePin(hooks));
  return router;
}
