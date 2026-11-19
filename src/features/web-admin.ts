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
import { MAP_PIN_HOOKS } from "./index";
import { START_LOCATIONS_FIELD } from "./location-vote";
import { setMapPinAction } from "./map-pin";
import {
  CANCEL_QUESTION,
  closeQuestion,
  type ConfirmQuestion,
} from "./poll-ui";
import {
  cancelRound,
  closeVote,
  dateVoteRefusal,
  defaultDates,
  locationVoteRefusal,
  pollWordings,
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
 * A control the web page offers: the panel's round controls, and Withdraw
 * date vote while a date vote is open. Set map pin is offered by the
 * page's Where section (`hike-place.tsx`) rather than the Admin card.
 */
export type WebAdminActionKind = PanelActionKind | "withdraw-date-vote";

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
  /**
   * For a control that asks first (Close, Cancel round, Withdraw date
   * vote), the question and what it does, in the panel's words; null for
   * the others.
   */
  confirm: ConfirmQuestion | null;
}

/** What the web page asks before it withdraws a date vote. */
export const WITHDRAW_QUESTION: ConfirmQuestion = {
  question: "Withdraw the date vote?",
  consequence:
    "The date vote is taken back with its dates and votes, and its message shows it as cancelled. The location stays decided, so you can start a new date vote.",
};

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
  const refusal = locationVoteRefusal(context);
  return {
    actions: webAdminActions(source.storage),
    setupMissing: refusal?.code === "setup_incomplete" ? refusal.message : null,
    locationsField: { ...START_LOCATIONS_FIELD },
    datesField: {
      ...START_DATES_FIELD,
      value: dateVoteRefusal(context) === null ? defaultDates(context) : [],
    },
  };
}

/**
 * The controls the Admin card offers now, in the panel's order: the
 * panel's (`panelActions`) but Set map pin, which the Where section
 * offers, with Withdraw date vote before Cancel round while a date vote is
 * open.
 */
export function webAdminActions(
  storage: DurableObjectStorage,
): WebAdminAction[] {
  const state = loadAdminPanelState(storage);
  const wordings = pollWordings();
  const polls = [state.round?.locationPoll, state.round?.datePoll];
  const actions: WebAdminAction[] = [];
  for (const action of panelActions(state)) {
    if (action.kind === "set-map-pin") continue;
    const datePoll = state.round?.datePoll;
    if (action.kind === "cancel-round" && datePoll?.status === "open") {
      actions.push({
        kind: "withdraw-date-vote",
        label: "Withdraw date vote",
        target: datePoll.id,
        style: "quiet",
        note: null,
        confirm: WITHDRAW_QUESTION,
      });
    }
    const closing = polls.find((poll) => poll?.id === action.target);
    const wording = closing && wordings[closing.kind];
    actions.push({
      ...action,
      kind: action.kind,
      note: action.note ?? null,
      confirm:
        action.kind === "cancel-round"
          ? CANCEL_QUESTION
          : action.kind === "close-vote" && wording
            ? closeQuestion(wording)
            : null,
    });
  }
  return actions;
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
      /**
       * The retries offered once the work is done, each with the panel's
       * line on what failed; none while `finishing`.
       */
      retries: WebAdminAction[];
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
  let notes: string[] | null;
  try {
    notes = await Promise.race([work, late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (notes === null) {
    work.catch((error: unknown) => {
      console.error(
        `the web action ${request.action} went on after its answer and failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return { kind: "done", notes: [], finishing: true, retries: [] };
  }
  return {
    kind: "done",
    notes,
    finishing: false,
    retries: webAdminActions(context.storage).filter(
      (action) => action.note !== null,
    ),
  };
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
    case "set-map-pin":
      return setMapPinAction(
        context,
        { roundId: target, input: request.text ?? "" },
        MAP_PIN_HOOKS,
      );
  }
}
