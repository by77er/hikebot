/**
 * The server's page, a section after the location vote's card: what
 * **Propose a location** offers in Discord. A select of past locations to suggest
 * again (neither on the vote nor resting), with the bot's line naming the
 * resting ones and the hikes they have left, and a form with the modal's
 * fields: the name, the details and the map link or coordinates. Both post
 * to `/g/<guild id>/polls/<poll id>/options`. A refused proposal shows the
 * bot's sentence at the top of its form and on its field, with what was
 * sent kept. While the vote is full it shows the bot's sentence instead.
 * Nothing while no location vote is open.
 */
import type { WebView } from "../../../guild/web-view";
import { CsrfField } from "../../auth/csrf";
import { Button } from "../../components/button";
import { ErrorSummary } from "../../components/error-summary";
import { FormActions } from "../../components/form-actions";
import { MapPinIcon } from "../../components/icons";
import { Select } from "../../components/select";
import { TextField } from "../../components/text-field";
import { Textarea } from "../../components/textarea";
import { BotSentence } from "./bot-sentence";
import { optionsPath, refusalFor, type PageForms } from "./forms";

/** The longest name, details and map link the modal takes. */
export const LOCATION_LIMITS = { name: 80, details: 300, map: 1000 };

export function ProposeLocation({
  view,
  forms,
}: {
  view: WebView;
  forms: PageForms;
}) {
  const vote = view.round?.vote ?? null;
  if (vote?.propose.kind !== "location") return null;
  const { propose } = vote;
  const action = optionsPath(view.server.id, vote.pollId);
  const offersAgain = propose.again.length > 0 || propose.resting !== null;
  return (
    <section class="stack" aria-labelledby="propose-location">
      <h2 id="propose-location">Propose a location</h2>
      {propose.refusal !== null ? (
        <p>
          <BotSentence text={propose.refusal} />
        </p>
      ) : (
        <>
          {offersAgain && (
            <>
              <p>
                Put one from an earlier round on the vote again, or add a new
                one.
              </p>
              <SuggestAgain view={view} forms={forms} action={action} />
            </>
          )}
          <NewLocation
            view={view}
            forms={forms}
            action={action}
            heading={offersAgain}
          />
        </>
      )}
    </section>
  );
}

function SuggestAgain({
  view,
  forms,
  action,
}: {
  view: WebView;
  forms: PageForms;
  action: string;
}) {
  const vote = view.round?.vote;
  if (vote?.propose.kind !== "location") return null;
  const { again, resting } = vote.propose;
  const refusal = refusalFor(view, forms, "again");
  return (
    <section class="stack stack--tight" aria-labelledby="suggest-again">
      <h3 id="suggest-again">Suggest one again</h3>
      {refusal && (
        <ErrorSummary
          title="The location was not added."
          errors={[
            {
              field: "suggest-again-location",
              message: <BotSentence text={refusal.message} />,
            },
          ]}
        />
      )}
      {again.length > 0 && (
        <form
          class="stack stack--loose"
          method="post"
          action={action}
          novalidate
        >
          <CsrfField token={forms.csrf} />
          <Select
            id="suggest-again-location"
            name="again"
            label="Earlier location"
            required
            options={again.map((option) => ({
              value: String(option.optionId),
              label: option.label,
            }))}
            value={refusal ? String(refusal.optionId) : undefined}
            error={refusal ? <BotSentence text={refusal.message} /> : undefined}
          />
          <FormActions>
            <Button>Suggest again</Button>
          </FormActions>
        </form>
      )}
      {resting !== null && (
        <p class="u-muted">
          <BotSentence text={resting} />
        </p>
      )}
    </section>
  );
}

function NewLocation({
  view,
  forms,
  action,
  heading,
}: {
  view: WebView;
  forms: PageForms;
  action: string;
  /** Whether it is one of two ways to propose, under its own heading. */
  heading: boolean;
}) {
  const refusal = refusalFor(view, forms, "location");
  const field =
    refusal?.code === "invalid_details"
      ? "new-location-details"
      : "new-location-name";
  const error = refusal ? <BotSentence text={refusal.message} /> : undefined;
  return (
    <section
      class="stack stack--tight"
      aria-labelledby={heading ? "new-location" : "propose-location"}
    >
      {heading && <h3 id="new-location">New location</h3>}
      {refusal && (
        <ErrorSummary
          title="Your location was not added."
          errors={[{ field, message: error }]}
        />
      )}
      <form class="stack stack--loose" method="post" action={action} novalidate>
        <CsrfField token={forms.csrf} />
        <TextField
          id="new-location-name"
          name="name"
          label="Name"
          required
          maxLength={LOCATION_LIMITS.name}
          autoComplete="off"
          value={refusal?.name}
          error={field === "new-location-name" ? error : undefined}
        />
        <Textarea
          id="new-location-details"
          name="details"
          label="Details"
          hint="Optional: a trail link, the distance, notes"
          rows={3}
          maxLength={LOCATION_LIMITS.details}
          value={refusal?.details}
          error={field === "new-location-details" ? error : undefined}
        />
        <TextField
          id="new-location-map"
          name="map"
          label="Map link or coordinates"
          hint="Optional: a Google Maps, OpenStreetMap or Apple Maps link, or lat, lon"
          maxLength={LOCATION_LIMITS.map}
          autoComplete="off"
          spellCheck={false}
          value={refusal?.map}
        />
        <FormActions>
          <Button icon={MapPinIcon}>Propose location</Button>
        </FormActions>
      </form>
    </section>
  );
}
