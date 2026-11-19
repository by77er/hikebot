/**
 * Status pill: the state of a vote, a round or a hike in one word with an
 * icon: Open, Closed, Decided, Cancelled or Planned, the words the bot uses
 * for them. Put it next to what it describes (a vote's heading, a hike
 * card); the word is what a screen reader reads, and the icon's shape and
 * the colour repeat it, so the state never rests on colour alone.
 */
import type { IconComponent } from "./icon";
import {
  CalendarCheckIcon,
  CircleCheckIcon,
  CircleXIcon,
  LockIcon,
  VoteIcon,
} from "./icons";

export type Status = "open" | "closed" | "decided" | "cancelled" | "planned";

/** Every status, in the order a round goes through them. */
export const STATUSES: Status[] = [
  "open",
  "closed",
  "decided",
  "planned",
  "cancelled",
];

const LOOK: Record<Status, { word: string; icon: IconComponent }> = {
  open: { word: "Open", icon: VoteIcon },
  closed: { word: "Closed", icon: LockIcon },
  decided: { word: "Decided", icon: CircleCheckIcon },
  planned: { word: "Planned", icon: CalendarCheckIcon },
  cancelled: { word: "Cancelled", icon: CircleXIcon },
};

export function StatusPill({ status }: { status: Status }) {
  const { word, icon: StatusIcon } = LOOK[status];
  return (
    <span class={`status-pill status-pill--${status}`}>
      <StatusIcon class="status-pill__icon" size="small" />
      {word}
    </span>
  );
}
