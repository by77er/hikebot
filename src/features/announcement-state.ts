/**
 * Where a closed poll's announcement stands, kept under
 * `announcement:<poll id>` in the object's synchronous key-value storage
 * from the moment the close flow starts posting it: being posted (since
 * when), posted (its message id), or why the last attempt failed, with what
 * the announcement says besides the poll, so the panel's retry posts the
 * same one. Shared by the close flow and the retry in `poll-ui.ts` and the
 * admin panel, which only reads it.
 */
import { CLOSE_PART_CLAIM_MS } from "./close-flow-state";

const KEY_PREFIX = "announcement:";

/** What the announcement is made from, besides the poll and its round. */
export interface AnnouncementContent {
  guildId: string;
  /** The guild's time zone when the poll closed. */
  timeZone: string;
  /** The close steps' lines, such as the hike thread's link. */
  extra: string[];
}

type Attempt =
  { postingSince: number } | { messageId: string } | { error: string };

type Stored = AnnouncementContent & Attempt;

/** Where the poll's announcement stands, as the panel shows it. */
export type AnnouncementStatus =
  | { state: "none" }
  | { state: "posted"; messageId: string }
  | { state: "posting" }
  | { state: "failed"; reason: string }
  | { state: "unconfirmed" };

function key(pollId: number): string {
  return `${KEY_PREFIX}${String(pollId)}`;
}

/**
 * The announcement's status at `now`. A post that started more than
 * `CLOSE_PART_CLAIM_MS` ago was cut off before Discord's answer came back,
 * so it may or may not have been posted: it is unconfirmed.
 */
export function announcementStatus(
  storage: DurableObjectStorage,
  pollId: number,
  now: number,
): AnnouncementStatus {
  const stored = storage.kv.get<Stored>(key(pollId));
  if (stored === undefined) return { state: "none" };
  if ("messageId" in stored) {
    return { state: "posted", messageId: stored.messageId };
  }
  if ("error" in stored) return { state: "failed", reason: stored.error };
  return now - stored.postingSince < CLOSE_PART_CLAIM_MS
    ? { state: "posting" }
    : { state: "unconfirmed" };
}

/** What the poll's announcement was made from, once a post was tried. */
export function announcementContent(
  storage: DurableObjectStorage,
  pollId: number,
): AnnouncementContent | null {
  const stored = storage.kv.get<Stored>(key(pollId));
  if (stored === undefined) return null;
  return {
    guildId: stored.guildId,
    timeZone: stored.timeZone,
    extra: stored.extra,
  };
}

/**
 * Marks the poll's announcement, made from `content`, as being posted,
 * unless it was posted or a post younger than the claim is under way.
 * Synchronous, so of two attempts only the first gets true.
 */
export function claimAnnouncement(
  storage: DurableObjectStorage,
  pollId: number,
  content: AnnouncementContent,
  now: number,
): boolean {
  const state = announcementStatus(storage, pollId, now).state;
  if (state === "posted" || state === "posting") return false;
  storage.kv.put<Stored>(key(pollId), { ...content, postingSince: now });
  return true;
}

/** Records the posted announcement's message id, ending the claim. */
export function recordAnnouncementPosted(
  storage: DurableObjectStorage,
  pollId: number,
  messageId: string,
): void {
  const content = announcementContent(storage, pollId);
  if (content === null) return;
  storage.kv.put<Stored>(key(pollId), { ...content, messageId });
}

/** Records why posting the announcement failed, ending the claim. */
export function recordAnnouncementFailure(
  storage: DurableObjectStorage,
  pollId: number,
  reason: string,
): void {
  const content = announcementContent(storage, pollId);
  if (content === null) return;
  storage.kv.put<Stored>(key(pollId), { ...content, error: reason });
}
