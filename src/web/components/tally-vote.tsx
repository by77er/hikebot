/**
 * Tally vote: the votable form of a tally. Every option is a `TallyRow`
 * whose label is a real checkbox's label, checked for the viewer's saved
 * votes, inside a `<form method="post">` with one **Vote** button, so it
 * works without JavaScript: the form sends every checked option's id under
 * `name`, and the route replaces the member's votes with them, as the
 * bot's vote select does. Put the CSRF field and any other hidden fields
 * in `hidden`. The instructions are the group's legend.
 */
import type { ComponentChildren } from "preact";
import { Button } from "./button";
import { VoteIcon } from "./icons";
import { TallyList, type TallyListProps } from "./tally-list";

export interface TallyVoteProps extends Omit<
  TallyListProps,
  "choice" | "winnerId" | "tiedOptions"
> {
  /** The route the form posts to. */
  action: string;
  /** The field each checked option's id is sent under. Defaults to "option". */
  name?: string;
  /** The bot's instructions, such as "Vote for every location you would go to…". */
  instructions: string;
  /** Hidden fields: the CSRF token, the poll's id. */
  hidden?: ComponentChildren;
}

export function TallyVote({
  action,
  name = "option",
  instructions,
  hidden,
  ...list
}: TallyVoteProps) {
  return (
    <form class="tally-vote" method="post" action={action}>
      {hidden}
      <fieldset class="tally-vote__fieldset">
        <legend class="tally-vote__legend">{instructions}</legend>
        <TallyList {...list} choice={{ name }} />
      </fieldset>
      {list.options.length > 0 && (
        <div class="tally-vote__actions">
          <Button variant="primary" icon={VoteIcon}>
            Vote
          </Button>
        </div>
      )}
    </form>
  );
}
