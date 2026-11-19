/**
 * The admin controls of a server's web page, inside the guild object: the
 * view's `admin` section (`adminSection`), which offers an admin the round
 * controls the Discord admin panel offers in the same state
 * (`panelActions`), and the run of the control a web form posts
 * (`runWebAdminAction`), which calls the round action of
 * `round-actions.ts` and nothing else. The web page adds no rule of its
 * own: every refusal and every note is the panel's sentence.
 */
import type { WebViewSource } from "../guild/web-view";
import {
  loadAdminPanelState,
  panelActions,
  type PanelActionKind,
} from "./admin-panel";
import { START_DATES_FIELD, startDateVoteOnSchedule } from "./date-vote";
import { START_LOCATIONS_FIELD } from "./location-vote";
import {
  cancelRound,
  closeVote,
  dateVoteRefusal,
  defaultDates,
  locationVoteRefusal,
  postVoteMessage,
  retryAnnouncement,
  retryHikeDay,
  retryHikeEvent,
  retryHikeThread,
  retryMapPicture,
  startLocationVote,
  withdrawDateVote,
  type ActionOutcome,
  type RoundContext,
} from "./round-actions";

/** How long a web action waits for its Discord work before it answers. */
export const WEB_WORK_WAIT_MS = 20_000;

/**
 * A control the web page offers: the panel's round controls but Set map
 * pin (it needs the place lookup the panel's modal does), and Withdraw
 * date vote while a date vote is open.
 */
export type WebAdminActionKind =
  Exclude<PanelActionKind, "set-map-pin"> | "withdraw-date-vote";

export interface WebAdminAction {
  kind: WebAdminActionKind;
  /** The panel's label: "Close location vote". */
  label: string;
  /** The poll or round it acts on; null for a start. */
  target: number | null;
  /**
   * `primary` for the round's next step, `danger` for Cancel round,
   * `quiet` for Withdraw date vote, `secondary` for the rest.
   */
  style: "primary" | "secondary" | "quiet" | "danger";
  /** For a retry, the panel's line on what failed; null otherwise. */
  note: string | null;
}

/** A start form's field, as the panel's start modal has it. */
export interface WebStartField {
  label: string;
  hint: string;
  placeholder: string;
  maxLength: number;
  required: boolean;
}

/** What an admin may do to the round now; only an admin's view has it. */
export interface WebAdminSection {
  /** In the panel's order. */
  actions: WebAdminAction[];
  /**
   * Why no vote can be started, while setup is not complete: the panel's
   * sentence. Null once setup is complete.
   */
  setupMissing: string | null;
  /** Start location vote's field. */
  locationsField: WebStartField;
  /** Start date vote's field, and the dates it is filled with. */
  datesField: WebStartField & { value: string[] };
}

/** The admin section of the view, null for a member who is not an admin. */
export function adminSection(source: WebViewSource): WebAdminSection | null {
  if (!source.isAdmin) return null;
  const context: RoundContext = {
    env: source.env,
    storage: source.storage,
    guildId: source.guildId,
    store: source.store,
  };
  const state = loadAdminPanelState(source.storage);
  const actions: WebAdminAction[] = [];
  for (const action of panelActions(state)) {
    if (action.kind === "set-map-pin") continue;
    if (
      action.kind === "cancel-round" &&
      state.round?.status === "date_voting"
    ) {
      const poll = state.round.datePoll;
      if (poll?.status === "open") {
        actions.push({
          kind: "withdraw-date-vote",
          label: "Withdraw date vote",
          target: poll.id,
          style: "quiet",
          note: null,
        });
      }
    }
    actions.push({ ...action, kind: action.kind, note: action.note ?? null });
  }
  const refusal = locationVoteRefusal(context);
  return {
    actions,
    setupMissing: refusal?.code === "setup_incomplete" ? refusal.message : null,
    locationsField: { ...START_LOCATIONS_FIELD },
    datesField: {
      ...START_DATES_FIELD,
      value: dateVoteRefusal(context) === null ? defaultDates(context) : [],
    },
  };
}

/** The control a web form posted. */
export interface WebAdminRequest {
  action: WebAdminActionKind;
  /** The poll or round the control was offered for; null for a start. */
  target: number | null;
  /** What was typed in a start form, as it came; null for the others. */
  text: string | null;
}

/** What a web action came to. */
export type WebAdminOutcome =
  | {
      kind: "refused";
      /** The round action's refusal code. */
      code: string;
      /** The panel's sentence. */
      message: string;
    }
  | {
      kind: "done";
      /** The panel's notes, or none yet while `finishing`. */
      notes: string[];
      /**
       * True when the Discord work took longer than `WEB_WORK_WAIT_MS`:
       * it goes on in the object (and a close in its durable flow).
       */
      finishing: boolean;
    };

/**
 * Runs the control `request` names as `actor`, with the round action the
 * panel's button calls, and awaits its Discord work for up to `waitMs`.
 * Does not check that the actor is an admin: the caller must.
 */
export async function runWebAdminAction(
  context: RoundContext,
  actor: string,
  request: WebAdminRequest,
  waitMs: number = WEB_WORK_WAIT_MS,
): Promise<WebAdminOutcome> {
  const outcome = await act(context, actor, request);
  if (!outcome.ok) {
    return { kind: "refused", code: outcome.code, message: outcome.message };
  }
  const work = outcome.work();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, waitMs);
  });
  const notes = await Promise.race([work, late]);
  if (timer !== undefined) clearTimeout(timer);
  if (notes === null) {
    work.catch((error: unknown) => {
      console.error(
        `the web action ${request.action} went on after its answer and failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return { kind: "done", notes: [], finishing: true };
  }
  return { kind: "done", notes, finishing: false };
}

/** Calls the round action `request` names, as the panel's handler does. */
function act(
  context: RoundContext,
  actor: string,
  request: WebAdminRequest,
): ActionOutcome<string, unknown> | Promise<ActionOutcome<string, unknown>> {
  const target = request.target ?? 0;
  const lines = (request.text ?? "").split(/\r?\n/);
  switch (request.action) {
    case "start-location-vote":
      return startLocationVote(context, actor, { labels: lines });
    case "start-date-vote":
      return startDateVoteOnSchedule(context, actor, { dates: lines });
    case "close-vote":
      return closeVote(context, actor, { pollId: target });
    case "withdraw-date-vote":
      return withdrawDateVote(context, actor, { pollId: target });
    case "cancel-round":
      return cancelRound(context, actor, { roundId: target });
    case "post-vote-message":
      return postVoteMessage(context, actor, { pollId: target });
    case "create-hike-thread":
      return retryHikeThread(context, actor, { roundId: target });
    case "create-hike-event":
      return retryHikeEvent(context, actor, { roundId: target });
    case "show-map-picture":
      return retryMapPicture(context, actor, { roundId: target });
    case "post-hike-day":
      return retryHikeDay(context, actor, { roundId: target });
    case "announce":
      return retryAnnouncement(context, actor, { pollId: target });
  }
}
