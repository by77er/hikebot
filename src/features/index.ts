import type { Router } from "../guild/router";
import { registerAdminPanel } from "./admin-panel";
import { hikeCommand } from "./hike";

/**
 * Registers every feature's handlers. A feature keeps its handlers in its own
 * file under src/features/ and adds one line here, for example:
 *
 *   router.command("hike", hikeCommand);
 *   router.component("hb:poll:vote", openVoteSelect);
 *   router.modal("hb:location:propose", saveProposal);
 */
export function registerFeatures(router: Router): Router {
  router.command("hike", hikeCommand);
  registerAdminPanel(router);
  return router;
}
