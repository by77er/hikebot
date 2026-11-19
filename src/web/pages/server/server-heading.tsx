/**
 * The server's page, first section: a quiet Switch server link back to the
 * list of servers, the server's icon and name as the page's heading, and
 * the round stepper at the step the round is at (the planned hike when no
 * round is open). With neither, there is no step to show.
 */
import type { WebView } from "../../../guild/web-view";
import { Avatar } from "../../components/avatar";
import { BackLink } from "../../components/back-link";
import { RoundStepper, type RoundStep } from "../../components/round-stepper";

const STEPS = {
  location_vote_open: "location",
  location_decided: "date",
  date_vote_open: "date",
} as const;

/** The stepper's step for the view, or null with no round and no hike. */
export function stepOf(view: WebView): RoundStep | null {
  if (view.round !== null) return STEPS[view.round.step];
  return view.plannedHike === null ? null : "planned";
}

export function ServerHeading({ view }: { view: WebView }) {
  const step = stepOf(view);
  return (
    <div class="stack">
      <BackLink href="/servers">Switch server</BackLink>
      <div class="server-heading">
        <Avatar
          class="server-heading__icon"
          name={view.server.name}
          src={view.server.iconUrl}
          shape="square"
        />
        <h1 class="server-heading__name">{view.server.name}</h1>
      </div>
      {step !== null && <RoundStepper step={step} />}
    </div>
  );
}
