import type { HandlerContext, Router } from "../guild/router";
import { runDueJobs } from "../guild/schedule";
import { PollStore } from "../polls/store";
import { registerAdminPanel } from "./admin-panel";
import { registerCadence } from "./cadence";
import { registerDateVote } from "./date-vote";
import { hikeCommand } from "./hike";
import { registerHikeDay } from "./hike-day";
import { registerHikeEvent, updateEventPin } from "./hike-event";
import { registerHikeLog } from "./hike-log";
import { registerHikeThread, updateThreadPin } from "./hike-thread";
import { registerHomeArea } from "./home-area";
import { LOCATE_JOB, locatePlaces } from "./locate";
import { registerLocationVote } from "./location-vote";
import { registerMapPicture, updateMapPicture } from "./map-picture";
import { registerMapPin, type MapPinHook } from "./map-pin";
import { registerPollUi } from "./poll-ui";
import { pollWordings } from "./round-actions";
import { refreshWeatherPin, registerWeather } from "./weather";

/**
 * What runs after the decided location's map pin changes, in order. A
 * feature that shows the pin adds its hook here.
 */
export const MAP_PIN_HOOKS: readonly MapPinHook[] = [
  updateThreadPin,
  updateEventPin,
  updateMapPicture,
  refreshWeatherPin,
];

/**
 * Registers every feature's handlers. A feature keeps its handlers in its own
 * file under src/features/ and adds one line here, for example:
 *
 *   router.command("hike", hikeCommand);
 *   router.component("hb:poll:vote", openVoteSelect);
 *   router.modal("hb:location:propose", saveProposal);
 *   router.job("poll:refresh", refreshPollMessages);
 *
 * A feature with several controls can export one function that registers
 * them all, as `registerAdminPanel` does.
 */
export function registerFeatures(router: Router): Router {
  router.command("hike", hikeCommand);
  registerAdminPanel(router);
  registerPollUi(router, pollWordings());
  registerLocationVote(router);
  registerDateVote(router);
  registerHikeThread(router);
  registerHikeEvent(router);
  registerHikeDay(router);
  registerHikeLog(router);
  registerHomeArea(router);
  registerMapPin(router, MAP_PIN_HOOKS);
  registerMapPicture(router);
  router.job(LOCATE_JOB, locatePlaces);
  registerCadence(router);
  registerWeather(router);
  return router;
}

/**
 * The guild object's alarm: runs the scheduled jobs that are due, by the
 * clock the features share.
 */
export function runAlarm(
  router: Router,
  context: HandlerContext,
): Promise<void> {
  return runDueJobs(router, context, new PollStore(context.storage).now());
}
