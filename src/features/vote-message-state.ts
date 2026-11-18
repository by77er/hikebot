/**
 * Where an open poll's public message stands while none is recorded on the
 * poll, kept under `vote-message:<poll id>` in the object's synchronous
 * key-value storage: being posted (since when), or why the last attempt
 * failed. The message's ids themselves are on the poll (`setPollMessage`).
 * A post is claimed here before its Discord call, so the vote message is
 * created once however often **Post vote message** is pressed. Shared by
 * the round actions (`round-actions.ts`) and the admin panel, which only
 * reads it.
 */
import type { PollView } from "../polls/store";

/**
 * How long a post in progress keeps others from starting one. A claim
 * older than this, or made before the object restarted, was cut off.
 */
export const VOTE_MESSAGE_CLAIM_MS = 60_000;

const KEY_PREFIX = "vote-message:";

/** What is stored for a poll without a recorded message. */
type Attempt = { postingSince: number } | { error: string };

/** Where the poll's message stands, as the panel shows it. */
export type VoteMessageStatus =
  | { state: "posted"; channelId: string; messageId: string }
  | { state: "posting" }
  | { state: "failed"; reason: string }
  | { state: "unconfirmed" }
  | { state: "missing" };

/** Polls whose message a run of this instance of the object is posting. */
const posting = new WeakMap<DurableObjectStorage, Set<number>>();

function key(pollId: number): string {
  return `${KEY_PREFIX}${String(pollId)}`;
}

function postingIn(storage: DurableObjectStorage): Set<number> {
  let polls = posting.get(storage);
  if (polls === undefined) {
    polls = new Set();
    posting.set(storage, polls);
  }
  return polls;
}

/**
 * The status of `poll`'s message at `now`. A post claimed by an earlier
 * instance of the object (it restarted since), or longer ago than
 * `VOTE_MESSAGE_CLAIM_MS`, was cut off before Discord's answer was
 * recorded: the message may or may not exist, so it is unconfirmed.
 */
export function voteMessageStatus(
  storage: DurableObjectStorage,
  poll: PollView,
  now: number,
): VoteMessageStatus {
  if (poll.channelId !== null && poll.messageId !== null) {
    return {
      state: "posted",
      channelId: poll.channelId,
      messageId: poll.messageId,
    };
  }
  const attempt = storage.kv.get<Attempt>(key(poll.id));
  if (attempt === undefined) return { state: "missing" };
  if ("error" in attempt) return { state: "failed", reason: attempt.error };
  return postingIn(storage).has(poll.id) &&
    now - attempt.postingSince < VOTE_MESSAGE_CLAIM_MS
    ? { state: "posting" }
    : { state: "unconfirmed" };
}

/**
 * Marks `poll`'s message as being posted, unless it is recorded or a post
 * that may still finish is under way. Synchronous, so of two presses
 * handled one after the other only the first gets true.
 */
export function claimVoteMessage(
  storage: DurableObjectStorage,
  poll: PollView,
  now: number,
): boolean {
  const state = voteMessageStatus(storage, poll, now).state;
  if (state === "posted" || state === "posting") return false;
  storage.kv.put<Attempt>(key(poll.id), { postingSince: now });
  postingIn(storage).add(poll.id);
  return true;
}

/** Records why posting the poll's message failed, ending the claim. */
export function recordVoteMessageFailure(
  storage: DurableObjectStorage,
  pollId: number,
  reason: string,
): void {
  postingIn(storage).delete(pollId);
  storage.kv.put<Attempt>(key(pollId), { error: reason });
}

/** Forgets the poll's attempt, once its message is recorded or not wanted. */
export function clearVoteMessageAttempt(
  storage: DurableObjectStorage,
  pollId: number,
): void {
  postingIn(storage).delete(pollId);
  storage.kv.delete(key(pollId));
}
