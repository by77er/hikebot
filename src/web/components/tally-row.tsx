/**
 * Tally row: one option of a vote with its tally. Its label, the votes as
 * a number (tabular figures) and as a bar of the members who voted, the
 * winner (the blaze and "Winner") with the tie-break note when the winner
 * was drawn from a tie, the viewer's own vote, the details and who
 * proposed it. Given `choice`, the label is a real checkbox's label, for
 * the votable form (`TallyVote`). Rows sit in a `TallyList`. Every text in
 * it comes from members and is rendered as text.
 */
import { useId } from "preact/hooks";
import { Blaze } from "./blaze";
import type { Preview } from "./button";
import { CheckIcon } from "./icons";

export interface TallyOption {
  /** The option's id, the value its checkbox sends. */
  id: string;
  label: string;
  details?: string | null;
  /** Who proposed it, by name; date options have none. */
  proposer?: string | null;
  votes: number;
  /** The viewer's saved vote is on this option. */
  yourVote?: boolean;
}

export interface TallyRowProps {
  option: TallyOption;
  /** The number of members who voted in the poll: the bar's full length. */
  voterCount: number;
  /** The option won the closed vote. */
  winner?: boolean;
  /** With `winner`: how many options shared the top count, when it was a tie. */
  tiedOptions?: number;
  /** Puts the details behind a "Details" disclosure, for long lists. */
  collapseDetails?: boolean;
  /** Makes the row votable: a checkbox with this name, checked by `yourVote`. */
  choice?: { name: string };
  /** Style guide only: shows the checkbox's hover or focus state. */
  preview?: Preview;
}

/** The noun after a count, as the bot says it: "1 vote", "7 votes". */
export function voteWord(votes: number): string {
  return votes === 1 ? "vote" : "votes";
}

export function TallyRow({
  option,
  voterCount,
  winner = false,
  tiedOptions,
  collapseDetails = false,
  choice,
  preview,
}: TallyRowProps) {
  const countId = useId();
  const checkId = useId();
  const { label, details, proposer, votes, yourVote = false } = option;
  const className = [
    "tally-row",
    winner && "tally-row--winner",
    choice && "tally-row--votable",
  ]
    .filter(Boolean)
    .join(" ");
  const tieNote =
    winner && tiedOptions !== undefined && tiedOptions > 1
      ? `${String(tiedOptions)} options tied with ${String(votes)} ${voteWord(votes)} each; the winner was drawn at random.`
      : null;
  // In the votable form the checkbox shows the viewer's vote.
  const marks = winner || (yourVote && !choice);
  return (
    <div class={className}>
      <div class="tally-row__head">
        {choice ? (
          <label
            class="tally-row__label tally-row__choice"
            for={checkId}
            data-preview={preview === "focus" ? undefined : preview}
          >
            <input
              class="tally-row__check"
              type="checkbox"
              id={checkId}
              name={choice.name}
              value={option.id}
              checked={yourVote}
              aria-describedby={countId}
              data-preview={preview === "focus" ? preview : undefined}
            />
            <span>{label}</span>
          </label>
        ) : (
          <p class="tally-row__label">{label}</p>
        )}
        <p class="tally-row__count" id={countId}>
          <span class="tally-row__number">{votes}</span> {voteWord(votes)}
        </p>
      </div>
      <meter
        class="tally-row__bar"
        min={0}
        max={Math.max(voterCount, 1)}
        value={votes}
        aria-hidden="true"
      />
      {marks && (
        <p class="tally-row__marks">
          {winner && (
            <span class="tally-row__winner">
              <Blaze /> Winner
            </span>
          )}
          {yourVote && !choice && (
            <span class="tally-row__mine">
              <CheckIcon size="small" /> Your vote
            </span>
          )}
        </p>
      )}
      {tieNote && <p class="tally-row__tie">{tieNote}</p>}
      {details &&
        (collapseDetails ? (
          <details class="tally-row__more">
            <summary class="tally-row__summary">Details</summary>
            <p class="tally-row__details">{details}</p>
          </details>
        ) : (
          <p class="tally-row__details">{details}</p>
        ))}
      {proposer && <p class="tally-row__proposer">Proposed by {proposer}</p>}
    </div>
  );
}
