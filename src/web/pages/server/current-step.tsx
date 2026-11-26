/**
 * The server's page, second section: the card of the step the round is at.
 * An open vote shows its options as a tally, the viewer's own votes marked,
 * and Vote in Discord, linking to the poll's message; a decided location
 * waiting for its date vote says so. With no round and no planned hike, an
 * empty state says what happens next, and tells an admin where to start a
 * vote. With no round and a planned hike, the planned hike's section is the
 * page's news and this one shows nothing.
 */
import type {
  WebOpenVote,
  WebRoundSection,
} from "../../../features/round-section";
import type { WebView } from "../../../guild/web-view";
import { Button } from "../../components/button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { DiscordIcon } from "../../components/icons";
import { StatusPill } from "../../components/status-pill";
import { TallyList } from "../../components/tally-list";

export function CurrentStep({ view }: { view: WebView }) {
  const { round } = view;
  if (round === null) {
    return view.plannedHike === null ? <NoRound view={view} /> : null;
  }
  if (round.step === "location_decided") {
    return <LocationDecided round={round} isAdmin={view.viewer.isAdmin} />;
  }
  return <OpenVote view={view} round={round} />;
}

function NoRound({ view }: { view: WebView }) {
  return (
    <EmptyState title="No hike is being planned">
      {view.viewer.isAdmin
        ? "The next hike starts with a location vote. You are an admin: start one in Discord with /hike admin, then Start location vote."
        : "The next hike starts with a location vote. When an admin starts one, it shows here and in Discord."}
    </EmptyState>
  );
}

function LocationDecided({
  round,
  isAdmin,
}: {
  round: WebRoundSection;
  isAdmin: boolean;
}) {
  return (
    <Card title="Location vote">
      <div class="stack stack--tight">
        <p>
          <StatusPill status="decided" />
        </p>
        <p>
          <strong>{round.location?.label}</strong> won the location vote.
        </p>
        {round.location?.details && <p>{round.location.details}</p>}
        <p class="u-muted">
          {isAdmin
            ? "The date vote is next. You are an admin: start it in Discord with /hike admin, then Start date vote."
            : "The date vote is next. When an admin starts it, it shows here and in Discord."}
        </p>
      </div>
    </Card>
  );
}

function OpenVote({ view, round }: { view: WebView; round: WebRoundSection }) {
  const vote = round.vote;
  const isDate = round.step === "date_vote_open";
  const title = isDate ? "Date vote" : "Location vote";
  return (
    <Card title={title}>
      <div class="stack">
        <div class="stack stack--tight">
          <p>
            <StatusPill status="open" />
          </p>
          {isDate && round.location && (
            <p>
              Where: <strong>{round.location.label}</strong>
            </p>
          )}
          {isDate && (
            <p class="u-muted">Times are in {view.settings.timeZone}.</p>
          )}
        </div>
        {vote === null ? (
          <p>The vote is being opened in Discord.</p>
        ) : (
          <VoteTally vote={vote} isDate={isDate} />
        )}
      </div>
    </Card>
  );
}

function VoteTally({ vote, isDate }: { vote: WebOpenVote; isDate: boolean }) {
  const voted = vote.options.some((option) => option.viewerVoted);
  return (
    <>
      <TallyList
        label={isDate ? "Dates" : "Locations"}
        options={vote.options.map((option) => ({
          id: String(option.optionId),
          label: option.label,
          details: option.details,
          place: option.place,
          votes: option.votes,
          yourVote: option.viewerVoted,
        }))}
        voterCount={vote.voterCount}
        empty={
          isDate
            ? "No date has been proposed yet."
            : "No location has been proposed yet."
        }
      />
      <p>
        {voted
          ? "You have voted. You can change your votes in Discord."
          : "You have not voted yet."}
      </p>
      {vote.messageUrl === null ? (
        <p class="u-muted">The vote's message is being posted in Discord.</p>
      ) : (
        <div class="cluster">
          <Button variant="primary" href={vote.messageUrl} icon={DiscordIcon}>
            Vote in Discord
          </Button>
        </div>
      )}
    </>
  );
}
