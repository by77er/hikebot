/**
 * The hike's map picture: when the date vote closes, a close step after the
 * thread's and the event's asks `MapPainter` for the picture of the map
 * round the hike's pin, drawn from our own map data, uploads it as an
 * attachment of the hike thread's first message (shown above the map links
 * by a media gallery item) and sets it as the cover image of the hike's
 * scheduled event. It runs again when the pin moves, replacing the picture
 * on both. A hike without a pin, or whose pin our map data does not cover,
 * gets no picture and no error. If drawing or Discord fails, the links stay
 * and the panel shows why and offers **Show map picture**
 * (`hb:map:show:<round id>`, `retryMapPicture` in `round-actions.ts`).
 */
import type { APIMessageComponentInteraction } from "discord-api-types/v10";
import { discordApi, imageData, type FileUpload } from "../discord/api";
import { messageBody, parseCustomId } from "../discord/components";
import { adminOnly } from "../guild/permissions";
import type { ComponentHandler, HandlerContext, Router } from "../guild/router";
import { mapPainter } from "../maps/map-painter";
import type { MapPicture } from "../maps/picture";
import { PollStore, type RoundView } from "../polls/store";
import { POLL_CONTROL_IDS } from "./admin-panel";
import { renderThreadMessage } from "./hike-thread";
import type { MapPinHook } from "./map-pin";
import {
  claimMapPicture,
  clearMapPictureAttempt,
  recordMapPictureFailure,
  recordNoMapPicture,
  roundPin,
} from "./map-picture-state";
import {
  actorOf,
  answerPanel,
  errorText,
  roundContext,
  type CloseStep,
} from "./poll-ui";
import { retryMapPicture } from "./round-actions";

export const MAP_PICTURE_IDS = {
  show: POLL_CONTROL_IDS.showMapPicture,
} as const;

/**
 * The picture's file name on the thread's first message, which the media
 * gallery refers to as `attachment://hike-map.png`.
 */
export const MAP_PICTURE_FILE = "hike-map.png";

/** The media gallery's reference to the uploaded picture. */
export const MAP_PICTURE_URL = `attachment://${MAP_PICTURE_FILE}`;

const RETRY = "Click Show map picture to try again.";

/** What showing the picture came to. */
export type Shown =
  { ok: true; key: string | null } | { ok: false; reason: string };

/**
 * Puts `picture` on the round's thread and event, those that exist, or,
 * with no picture, takes the one they show off them. The thread's first
 * message is rendered again with the picture's gallery item, and the upload
 * replaces its attachments; the event's cover takes the picture as image
 * data. Returns why a Discord call failed, or null.
 */
async function putPicture(
  round: RoundView,
  picture: MapPicture | undefined,
  guildId: string,
  timeZone: string,
  context: HandlerContext,
): Promise<string | null> {
  const api = discordApi(context.env);
  if (round.threadId !== null) {
    const body = messageBody(
      renderThreadMessage(
        { ...round, mapPictureKey: picture?.key ?? null },
        guildId,
        timeZone,
        context.env.DISCORD_APPLICATION_ID,
      ),
    );
    try {
      // A forum thread's first message has the thread's id. The upload
      // replaces its attachments; without a picture, an empty
      // `attachments` removes the old one.
      await (picture === undefined
        ? api.editMessage(round.threadId, round.threadId, {
            ...body,
            attachments: [],
          })
        : api.editMessage(round.threadId, round.threadId, body, [
            pictureFile(picture),
          ]));
    } catch (error) {
      return `Could not show the map picture on the hike thread: ${errorText(error)}. ${RETRY}`;
    }
  }
  if (round.eventId !== null) {
    try {
      await api.editGuildScheduledEvent(guildId, round.eventId, {
        image:
          picture === undefined ? null : imageData(picture.png, "image/png"),
      });
    } catch (error) {
      return `Could not set the map picture as the hike event's cover: ${errorText(error)}. ${RETRY}`;
    }
  }
  return null;
}

function pictureFile(picture: MapPicture): FileUpload {
  return {
    name: MAP_PICTURE_FILE,
    data: picture.png,
    contentType: "image/png",
  };
}

/**
 * Draws the picture of round `roundId`'s pin and shows it on the round's
 * thread and event in place of the one they show, then records its bucket
 * key on the round. With no pin or no map data there, records that there
 * was nothing to draw, and takes a picture shown before off them; when
 * none was shown, Discord is not asked. On failure records why, for the
 * panel, and leaves the thread's links as they are. The caller has claimed
 * it with `claimMapPicture`.
 */
export async function showMapPicture(
  roundId: number,
  guildId: string,
  timeZone: string,
  context: HandlerContext,
): Promise<Shown> {
  const store = new PollStore(context.storage);
  const round = store.getRound(roundId);
  if (round === null) {
    clearMapPictureAttempt(context.storage, roundId);
    return { ok: true, key: null };
  }
  const pin = roundPin(round);
  let picture: MapPicture | undefined;
  try {
    picture =
      pin === null
        ? undefined
        : await mapPainter(context.env).picture({ lon: pin.lon, lat: pin.lat });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    const reason = `Could not draw the map picture: ${why}. ${RETRY}`;
    recordMapPictureFailure(context.storage, roundId, reason);
    return { ok: false, reason };
  }
  // Read again: the thread or the event may have been made meanwhile.
  const current = store.getRound(roundId) ?? round;
  if (picture === undefined && current.mapPictureKey === null) {
    recordNoMapPicture(context.storage, roundId);
    return { ok: true, key: null };
  }
  // Taken off the round first, so a run cut off half-way leaves no
  // thread message pointing at an attachment that may be gone.
  if (picture === undefined) store.setRoundMapPicture(roundId, null);
  const failed = await putPicture(current, picture, guildId, timeZone, context);
  if (failed !== null) {
    recordMapPictureFailure(context.storage, roundId, failed);
    return { ok: false, reason: failed };
  }
  if (picture === undefined) {
    recordNoMapPicture(context.storage, roundId);
    return { ok: true, key: null };
  }
  store.setRoundMapPicture(roundId, picture.key);
  clearMapPictureAttempt(context.storage, roundId);
  return { ok: true, key: picture.key };
}

/**
 * Shows the picture of round `roundId` again on its thread and event, when
 * it has a pin and no run is in progress: after its thread or event was
 * created by a retry. Returns the panel's note when it failed.
 */
export async function reshowMapPicture(
  roundId: number,
  guildId: string,
  timeZone: string,
  context: HandlerContext,
): Promise<string[]> {
  const store = new PollStore(context.storage);
  const round = store.getRound(roundId);
  if (
    round === null ||
    roundPin(round) === null ||
    (round.threadId === null && round.eventId === null) ||
    !claimMapPicture(context.storage, round, store.now())
  ) {
    return [];
  }
  const shown = await showMapPicture(roundId, guildId, timeZone, context);
  return shown.ok ? [] : [shown.reason];
}

/**
 * The date vote's close step: draws the picture and shows it on the thread
 * and the event made by the steps before. A hike without a pin, or without
 * a thread and an event, is skipped without drawing. It adds nothing to the
 * announcement; the panel shows a failure by itself.
 */
export const showMapPictureStep: CloseStep = {
  name: "show the map picture",
  run: async ({ round, guildId, timeZone }, context) => {
    const store = new PollStore(context.storage);
    const current = round === null ? null : store.getRound(round.id);
    if (
      current === null ||
      roundPin(current) === null ||
      (current.threadId === null && current.eventId === null) ||
      !claimMapPicture(context.storage, current, store.now())
    ) {
      return {};
    }
    await showMapPicture(current.id, guildId, timeZone, context);
    return {};
  },
};

/**
 * Show map picture: shows the picture of the last round again with
 * `retryMapPicture`, which claims it before the answer.
 */
const showAgain: ComponentHandler = adminOnly(
  (interaction: APIMessageComponentInteraction, context) =>
    answerPanel(
      interaction,
      context,
      retryMapPicture(
        roundContext(interaction, context),
        actorOf(interaction),
        {
          roundId: Number(parseCustomId(interaction.data.custom_id)?.arg),
        },
      ),
    ),
);

/**
 * After the map pin changed: draws the picture of the new pin and puts it
 * on the thread and the event in place of the old one, or takes the old one
 * off when the pin was cleared or our map data does not cover it. Only for
 * a completed round, whose thread or event exists; a failure shows on the
 * panel by itself.
 */
export const updateMapPicture: MapPinHook = {
  name: "update the map picture",
  run: async ({ round, guildId, timeZone }, context) => {
    if (
      round.status !== "complete" ||
      (round.threadId === null && round.eventId === null)
    ) {
      return;
    }
    const store = new PollStore(context.storage);
    if (!claimMapPicture(context.storage, round, store.now())) {
      throw new Error(
        "it is being drawn for the old pin; click Show map picture once that is done",
      );
    }
    await showMapPicture(round.id, guildId, timeZone, context);
  },
};

/** Registers the Show map picture button. */
export function registerMapPicture(router: Router): Router {
  router.component("hb:map:show", showAgain);
  return router;
}
