/**
 * Tally list: every option of a vote as a `TallyRow`, in the order the
 * poll message gives them (locations by votes, dates by date), under the
 * number of members who have voted, in the bot's words. Up to 25 rows; with
 * more than `COLLAPSE_AFTER` the details fold behind "Details", so the
 * labels and counts stay scannable on a phone. Given `choice`, every row is
 * votable: put it inside a `TallyVote` form.
 */
import { TallyRow, type TallyOption } from "./tally-row";

/** With more options than this, each row's details are folded away. */
export const COLLAPSE_AFTER = 6;

export interface TallyListProps {
  /** Names the list for assistive technology: "Locations", "Dates". */
  label: string;
  options: TallyOption[];
  voterCount: number;
  /** The id of the winning option, once the vote is closed. */
  winnerId?: string | null;
  /** How many options shared the top count, when the winner was drawn. */
  tiedOptions?: number;
  /** Shown when there are no options, such as the bot's "Propose one first." */
  empty?: string;
  /** Makes every row a checkbox with this name. */
  choice?: { name: string };
}

/** The bot's line under a poll: "No one has voted yet.", "3 members have voted." */
export function votersText(voterCount: number): string {
  if (voterCount === 0) return "No one has voted yet.";
  return voterCount === 1
    ? "1 member has voted."
    : `${String(voterCount)} members have voted.`;
}

export function TallyList({
  label,
  options,
  voterCount,
  winnerId,
  tiedOptions,
  empty = "There is nothing to vote for yet.",
  choice,
}: TallyListProps) {
  if (options.length === 0) {
    return <p class="tally-list__empty">{empty}</p>;
  }
  const collapse = options.length > COLLAPSE_AFTER;
  return (
    <div class="tally-list">
      <p class="tally-list__voters">{votersText(voterCount)}</p>
      <ol class="tally-list__rows" aria-label={label}>
        {options.map((option) => (
          <li key={option.id} class="tally-list__item">
            <TallyRow
              option={option}
              voterCount={voterCount}
              winner={winnerId === option.id}
              tiedOptions={winnerId === option.id ? tiedOptions : undefined}
              collapseDetails={collapse}
              choice={choice}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
