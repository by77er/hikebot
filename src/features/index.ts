import type { HandlerContext, Router } from "../guild/router";
import { registerAdminPanel } from "./admin-panel";
import { DATE_POLL, registerDateVote } from "./date-vote";
import { hikeCommand } from "./hike";
import { registerHikeThread } from "./hike-thread";
import { LOCATION_POLL, registerLocationVote } from "./location-vote";
import {
  refreshPollMessages,
  registerPollUi,
  type PollWordings,
} from "./poll-ui";

/** The poll kinds the shared poll controls serve. */
const POLL_KINDS: PollWordings = {
  location: LOCATION_POLL,
  date: DATE_POLL,
};

/**
 * Registers every feature's handlers. A feature keeps its handlers in its own
 * file under src/features/ and adds one line here, for example:
 *
 *   router.command("hike", hikeCommand);
 *   router.component("hb:poll:vote", openVoteSelect);
 *   router.modal("hb:location:propose", saveProposal);
 *
 * A feature with several controls can export one function that registers
 * them all, as `registerAdminPanel` does.
 */
export function registerFeatures(router: Router): Router {
  router.command("hike", hikeCommand);
  registerAdminPanel(router);
  registerPollUi(router, POLL_KINDS);
  registerLocationVote(router);
  registerDateVote(router);
  registerHikeThread(router);
  return router;
}

/** The guild object's alarm: refreshes the poll messages marked for it. */
export function runAlarm(context: HandlerContext): Promise<void> {
  return refreshPollMessages(context, POLL_KINDS);
}
