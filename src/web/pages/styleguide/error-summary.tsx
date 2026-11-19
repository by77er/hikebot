/**
 * Style guide: Error summary, at the top of a working form. The form
 * "Propose a location" submits to this page without JavaScript and comes
 * back as a real one would: with the summary, each field's error, and
 * what was typed kept. Without a submission it shows the form as it comes
 * back from a typical try.
 */
import { Banner } from "../../components/banner";
import { Button } from "../../components/button";
import { ErrorSummary } from "../../components/error-summary";
import { FormActions } from "../../components/form-actions";
import { MapPinIcon } from "../../components/icons";
import { TextField } from "../../components/text-field";
import { Textarea } from "../../components/textarea";
import { HINTS, LIMITS } from "./form-content";
import { Section, type SectionProps, type StyleguideSection } from "./section";

/** Locations already on the example vote. */
const ON_THE_VOTE = ["Mailbox Peak", "Rattlesnake Ledge", "Lake Serene"];

/** A typical first try: a name already on the vote and a short map link. */
const TYPICAL_TRY = {
  name: "Mailbox Peak",
  details: "The new trail, 9.4 miles. Bring microspikes.",
  map: "https://maps.app.goo.gl/Zx3cQe",
};

interface Proposal {
  name: string;
  details: string;
  map: string;
}

type ProposalErrors = Partial<Record<keyof Proposal, string>>;

const COORDINATES = /^-?\d{1,2}(\.\d+)?,\s*-?\d{1,3}(\.\d+)?$/;
const SHORT_LINK = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl)\//i;

/** The checks the bot makes, in its words. */
export function checkProposal(proposal: Proposal): ProposalErrors {
  const errors: ProposalErrors = {};
  const name = proposal.name.trim();
  if (name.length === 0 || name.length > LIMITS.name) {
    errors.name = "A name must be 1 to 80 characters.";
  } else if (
    ON_THE_VOTE.some((taken) => taken.toLowerCase() === name.toLowerCase())
  ) {
    errors.name = `${name} is already on the list. Vote for it instead.`;
  }
  if (proposal.details.length > LIMITS.details) {
    errors.details = "Details must be at most 300 characters.";
  }
  const map = proposal.map.trim();
  if (
    map !== "" &&
    (SHORT_LINK.test(map) ||
      !(COORDINATES.test(map) || /^https?:\/\/\S+$/i.test(map)))
  ) {
    errors.map =
      "No coordinates could be read from that. Enter lat, lon in decimal degrees such as 47.4875, -121.7234, or paste a Google Maps, OpenStreetMap or Apple Maps link that shows the coordinates (short links such as maps.app.goo.gl are not opened).";
  }
  return errors;
}

const FIELDS: { key: keyof Proposal; id: string }[] = [
  { key: "name", id: "proposal-name" },
  { key: "details", id: "proposal-details" },
  { key: "map", id: "proposal-map" },
];

function ErrorSummarySection({ query }: SectionProps) {
  const submitted = query?.has("name") ?? false;
  const proposal: Proposal = submitted
    ? {
        name: query?.get("name") ?? "",
        details: query?.get("details") ?? "",
        map: query?.get("map") ?? "",
      }
    : TYPICAL_TRY;
  const errors = checkProposal(proposal);
  const inError = FIELDS.filter(({ key }) => errors[key] !== undefined);
  const added = submitted && inError.length === 0;
  const shown = added ? { name: "", details: "", map: "" } : proposal;
  return (
    <Section
      id="error-summary"
      title="Error summary"
      intro="At the top of a form that came back with errors: what did not happen, then a link to each field in error, in the same words as the field. Try the form: it submits to this page without JavaScript and keeps what you typed."
    >
      {added && (
        <Banner
          tone="success"
          title={
            <>
              Added <strong>{proposal.name.trim()}</strong> to the location
              vote. Use <strong>Vote</strong> to vote for it.
            </>
          }
        >
          This is the style guide: nothing was added.
        </Banner>
      )}
      {inError.length > 0 && (
        <ErrorSummary
          title="Your location was not added."
          autoFocus={submitted}
          errors={inError.map(({ key, id }) => ({
            field: id,
            message: errors[key],
          }))}
        />
      )}
      <h3>Propose a location</h3>
      <form
        class="stack stack--loose"
        method="get"
        action="/styleguide/error-summary#error-summary"
        novalidate
      >
        <TextField
          id="proposal-name"
          name="name"
          label="Name"
          required
          maxLength={LIMITS.name}
          autoComplete="off"
          value={shown.name}
          error={errors.name}
        />
        <Textarea
          id="proposal-details"
          name="details"
          label="Details"
          hint={HINTS.details}
          maxLength={LIMITS.details}
          rows={3}
          value={shown.details}
          error={errors.details}
        />
        <TextField
          id="proposal-map"
          name="map"
          label="Map link or coordinates"
          hint={HINTS.mapLink}
          maxLength={LIMITS.mapLink}
          autoComplete="off"
          spellCheck={false}
          value={shown.map}
          error={errors.map}
        />
        <FormActions>
          <Button variant="primary" icon={MapPinIcon}>
            Propose a location
          </Button>
          <Button href="/styleguide">Back</Button>
        </FormActions>
      </form>
    </Section>
  );
}

export const errorSummarySection: StyleguideSection = {
  id: "error-summary",
  title: "Error summary",
  render: ErrorSummarySection,
  ownPage: true,
};
