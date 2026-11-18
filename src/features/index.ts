import type { HandlerContext, Router } from "../guild/router";
import { runDueJobs } from "../guild/schedule";
import { PollStore } from "../polls/store";
import { registerAdminPanel } from "./admin-panel";
import { registerDateVote } from "./date-vote";
import { hikeCommand } from "./hike";
import { registerHikeDay } from "./hike-day";
import { registerHikeEvent } from "./hike-event";
import { registerHikeLog } from "./hike-log";
import { registerHikeThread } from "./hike-thread";
import { registerLocationVote } from "./location-vote";
import { registerPollUi } from "./poll-ui";
import { pollWordings } from "./round-actions";

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
