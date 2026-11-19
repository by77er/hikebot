/**
 * Pagination: the way through a list that comes in pages, newest first,
 * such as the hike log: "Newer" and "Older", as the bot's buttons say,
 * with the current position in words between them ("Page 2 of 5"). A
 * direction that does not exist is shown disabled, as the bot shows it,
 * so the bar keeps its shape and a member sees they are at an end; it has
 * no link, so it cannot be focused or followed. Leave the bar out when
 * there is only one page. Its `label` names the navigation landmark,
 * such as "Hike log pages".
 */
import { Button } from "./button";
import { ArrowLeftIcon, ArrowRightIcon } from "./icons";

export interface PaginationProps {
  /** Names the navigation landmark: "Hike log pages". */
  label: string;
  /** Where the member is, in words: "Page 2 of 5". */
  position: string;
  /** The page of newer items, or nothing on the first page. */
  newer?: string;
  /** The page of older items, or nothing on the last page. */
  older?: string;
}

export function Pagination({ label, position, newer, older }: PaginationProps) {
  return (
    <nav class="pagination" aria-label={label}>
      <span class="pagination__newer">
        <Button
          variant="secondary"
          href={newer ?? ""}
          disabled={newer === undefined}
          icon={ArrowLeftIcon}
        >
          Newer
        </Button>
      </span>
      <p class="pagination__position">{position}</p>
      <span class="pagination__older">
        <Button
          variant="secondary"
          href={older ?? ""}
          disabled={older === undefined}
          iconAfter={ArrowRightIcon}
        >
          Older
        </Button>
      </span>
    </nav>
  );
}
