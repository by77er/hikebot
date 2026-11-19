/**
 * The pages of the admin controls' two starts, under
 * `/g/<guild id>/admin/`: Start location vote, with the initial locations
 * one per line (none is fine), and Start date vote, with the candidate
 * dates filled in as the panel's modal fills them. Each is the modal as a
 * form: the same field, label, hint and limit. A refused start comes back
 * as the same page with what was typed and the panel's sentence.
 */
import type { WebStartField } from "../../../../features/web-admin";
import type { WebView } from "../../../../guild/web-view";
import { TEXT_FIELD } from "../../../admin/fields";
import { CsrfField } from "../../../auth/csrf";
import { BackLink } from "../../../components/back-link";
import { Button } from "../../../components/button";
import { ErrorSummary } from "../../../components/error-summary";
import { FormActions } from "../../../components/form-actions";
import { Textarea } from "../../../components/textarea";
import { Layout, type LayoutUser } from "../../../layout";
import { adminPath } from "../admin-retry";

export type StartKind = "start-location-vote" | "start-date-vote";

const PAGES: Record<
  StartKind,
  { title: string; eyebrow: string; notStarted: string }
> = {
  "start-location-vote": {
    title: "Start location vote",
    eyebrow: "Location vote",
    notStarted: "The location vote was not started.",
  },
  "start-date-vote": {
    title: "Start date vote",
    eyebrow: "Date vote",
    notStarted: "The date vote was not started.",
  },
};

const FIELD_ID = "start-text";

export function StartVotePage({
  user,
  view,
  kind,
  field,
  csrf,
  typed,
  error,
}: {
  user: LayoutUser;
  view: WebView;
  kind: StartKind;
  field: WebStartField;
  csrf: string;
  /** What the field holds: what was typed, or what it starts with. */
  typed: string;
  /** The panel's sentence for a refused start. */
  error?: string;
}) {
  const page = PAGES[kind];
  const vote = view.settings.voteChannel;
  const where = vote?.name == null ? "the voting channel" : `#${vote.name}`;
  const location = view.round?.location?.label;
  return (
    <Layout
      title={`${error === undefined ? "" : "Error: "}${page.title} · ${view.server.name} · hikebot`}
      user={user}
    >
      <div class="stack stack--section">
        <BackLink href={`/g/${view.server.id}`}>
          Back to {view.server.name}
        </BackLink>
        <div class="page-heading">
          <p class="page-heading__eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p class="page-heading__lead">
            {kind === "start-location-vote"
              ? `The vote opens in ${where}. Leave the field empty to let members propose the locations.`
              : `The vote opens in ${where}${location === undefined ? "" : ` for ${location}`}. Times are in ${view.settings.timeZone}.`}
          </p>
        </div>
        {error !== undefined && (
          <ErrorSummary
            title={page.notStarted}
            errors={[{ field: FIELD_ID, message: error }]}
          />
        )}
        <form
          class="stack stack--loose"
          method="post"
          action={adminPath(view.server.id, kind)}
          novalidate
        >
          <CsrfField token={csrf} />
          <Textarea
            id={FIELD_ID}
            name={TEXT_FIELD}
            label={field.label}
            hint={field.hint}
            required={field.required}
            maxLength={field.maxLength}
            rows={6}
            spellCheck={kind === "start-location-vote"}
            value={typed}
            error={error}
          />
          <FormActions>
            <Button variant="primary">{page.title}</Button>
            <Button href={`/g/${view.server.id}`}>Back</Button>
          </FormActions>
        </form>
      </div>
    </Layout>
  );
}
