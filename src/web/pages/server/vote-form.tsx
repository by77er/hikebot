/**
 * The server's page, in the open vote's card: the vote as a form, one
 * checkbox per option with the viewer's votes ticked, and Save votes,
 * which posts to `/g/<guild id>/polls/<poll id>/votes`; the member's votes
 * become exactly the ticked ones, none clearing them, as the bot's Vote
 * select does. A refused save shows the bot's sentence above the options,
 * ticked as they were sent.
 */
import type { WebOpenVote } from "../../../features/round-section";
import type { WebView } from "../../../guild/web-view";
import { CsrfField } from "../../auth/csrf";
import { Banner } from "../../components/banner";
import { TallyVote } from "../../components/tally-vote";
import { BotSentence } from "./bot-sentence";
import { refusalFor, votesPath, type PageForms } from "./forms";

export function VoteForm({
  view,
  vote,
  forms,
}: {
  view: WebView;
  vote: WebOpenVote;
  forms: PageForms;
}) {
  const refusal = refusalFor(view, forms, "votes");
  const isDate = vote.kind === "date";
  return (
    <>
      {refusal && (
        <Banner tone="danger" title="Your votes were not saved.">
          <p>
            <BotSentence text={refusal.message} />
          </p>
        </Banner>
      )}
      <TallyVote
        action={votesPath(view.server.id, vote.pollId)}
        instructions={vote.instructions}
        submit="Save votes"
        hidden={<CsrfField token={forms.csrf} />}
        label={isDate ? "Dates" : "Locations"}
        options={vote.options.map((option) => ({
          id: String(option.optionId),
          label: option.label,
          details: option.details,
          place: option.place,
          votes: option.votes,
          yourVote: refusal
            ? refusal.optionIds.includes(option.optionId)
            : option.viewerVoted,
        }))}
        voterCount={vote.voterCount}
        counted={{ at: view.now, timeZone: view.settings.timeZone }}
        empty={
          isDate
            ? "No date has been proposed yet."
            : "No location has been proposed yet."
        }
      />
    </>
  );
}
