/**
 * The server's page, after the date vote's card: what **Propose a date**
 * offers in Discord. A date picker limited to the days a member may
 * propose and an optional time, posting to
 * `/g/<guild id>/polls/<poll id>/options`; the server checks the days
 * again, as the bot does. A refused date shows the bot's sentence at the
 * top of the form and on the date, with what was sent kept. While the
 * member may add no date (they already proposed one to this vote, the vote
 * is full, or the round's days have passed) it shows the bot's sentence
 * instead. Nothing while no date vote is open.
 */
import type { WebView } from "../../../guild/web-view";
import { CsrfField } from "../../auth/csrf";
import { Button } from "../../components/button";
import { ErrorSummary } from "../../components/error-summary";
import { FormActions } from "../../components/form-actions";
import { CalendarPlusIcon } from "../../components/icons";
import { TextField } from "../../components/text-field";
import { BotSentence } from "./bot-sentence";
import { optionsPath, refusalFor, type PageForms } from "./forms";

export function ProposeDate({
  view,
  forms,
}: {
  view: WebView;
  forms: PageForms;
}) {
  const vote = view.round?.vote ?? null;
  if (vote?.propose.kind !== "date") return null;
  const { propose } = vote;
  const refusal = refusalFor(view, forms, "date");
  const error = refusal ? <BotSentence text={refusal.message} /> : undefined;
  return (
    <section class="stack" aria-labelledby="propose-date">
      <h2 id="propose-date">Propose a date</h2>
      {propose.refusal !== null ? (
        <p>
          <BotSentence text={propose.refusal} />
        </p>
      ) : (
        <div class="stack">
          {refusal && (
            <ErrorSummary
              title="Your date was not added."
              errors={[{ field: "propose-date-day", message: error }]}
            />
          )}
          <form
            class="stack stack--loose"
            method="post"
            action={optionsPath(view.server.id, vote.pollId)}
            novalidate
          >
            <CsrfField token={forms.csrf} />
            <TextField
              id="propose-date-day"
              name="date"
              type="date"
              label="Date"
              hint={`${propose.first} to ${propose.last}.`}
              required
              min={propose.first}
              max={propose.last}
              width="short"
              value={refusal?.date}
              error={error}
            />
            <TextField
              id="propose-date-time"
              name="time"
              type="time"
              label="Time"
              hint={`Optional, in ${view.settings.timeZone}; the time defaults to ${propose.defaultTime}.`}
              width="short"
              value={refusal?.time}
            />
            <FormActions>
              <Button
                icon={CalendarPlusIcon}
                variant={vote.options.length === 0 ? "primary" : "secondary"}
              >
                Propose date
              </Button>
            </FormActions>
          </form>
        </div>
      )}
    </section>
  );
}
