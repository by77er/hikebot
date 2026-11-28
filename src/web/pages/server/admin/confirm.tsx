/**
 * The confirmation page of an admin control that asks first, under
 * `/g/<guild id>/admin/`: Close location vote, Close date vote, Withdraw
 * date vote and Cancel round. It asks the panel's question, restates what
 * the control does in the panel's words, and shows what it applies to: the
 * open vote's current tally with when it was counted, or the decided
 * location. The server's name heads it, since nothing else on the page
 * says which server the action is taken on. Only the form's POST
 * acts; the page itself changes nothing.
 */
import type { WebAdminAction } from "../../../../features/web-admin";
import type { WebView } from "../../../../guild/web-view";
import { TARGET_FIELD } from "../../../admin/fields";
import { CsrfField } from "../../../auth/csrf";
import { Confirmation } from "../../../components/confirmation";
import { TallyList } from "../../../components/tally-list";
import { Layout, type LayoutUser } from "../../../layout";
import { adminPath } from "../admin-retry";

function AppliesTo({ view }: { view: WebView }) {
  const round = view.round;
  if (round === null) return null;
  const vote = round.vote;
  const isDate = round.step === "date_vote_open";
  return (
    <>
      {round.location !== null && (
        <p>
          Location: <strong>{round.location.label}</strong>
        </p>
      )}
      {vote !== null && (
        <TallyList
          label={isDate ? "Dates" : "Locations"}
          options={vote.options.map((option) => ({
            id: String(option.optionId),
            label: option.label,
            details: option.details,
            votes: option.votes,
            yourVote: option.viewerVoted,
          }))}
          voterCount={vote.voterCount}
          counted={{ at: view.now, timeZone: view.settings.timeZone }}
          empty={
            isDate
              ? "Nobody has proposed a date for this vote."
              : "Nobody has proposed a location for this vote."
          }
        />
      )}
      {isDate && <p class="u-muted">Times are in {view.settings.timeZone}.</p>}
    </>
  );
}

export function AdminConfirmPage({
  user,
  view,
  action,
  csrf,
}: {
  user: LayoutUser;
  view: WebView;
  /** A control with a `confirm`. */
  action: WebAdminAction;
  csrf: string;
}) {
  const question = action.confirm?.question ?? action.label;
  return (
    <Layout title={`${question} · ${view.server.name} · hikebot`} user={user}>
      <Confirmation
        eyebrow={view.server.name}
        title={question}
        formAction={adminPath(view.server.id, action.kind)}
        fields={
          <>
            <CsrfField token={csrf} />
            <input
              type="hidden"
              name={TARGET_FIELD}
              value={String(action.target)}
            />
          </>
        }
        action={{
          label: action.label,
          variant: action.kind === "close-vote" ? "primary" : "danger",
        }}
        back={{ href: `/g/${view.server.id}`, label: "Back" }}
      >
        <div class="stack">
          <p>{action.confirm?.consequence}</p>
          <AppliesTo view={view} />
        </div>
      </Confirmation>
    </Layout>
  );
}
