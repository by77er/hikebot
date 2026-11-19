/**
 * Set map pin for a server's planned hike, at `/g/<guild id>/map-pin`, for
 * an admin: the form the panel's modal is, filled with the current pin or
 * what was typed, under where the pin is now. A form that could not be
 * read comes back with the error at the field and in the summary; a pin
 * that was set but whose follow-up work partly failed comes back with what
 * failed, as the panel's notes say it. `MapPinRefusedPage` answers a member
 * who is not an admin, and a hike whose pin can no longer be set.
 */
import type { WebView } from "../../../guild/web-view";
import { BackLink } from "../../components/back-link";
import { Banner } from "../../components/banner";
import { ErrorSummary } from "../../components/error-summary";
import { MapLinks } from "../../components/map-links";
import { Layout, type LayoutUser } from "../../layout";
import { MessagePage } from "../message";
import { MAP_PIN_FIELD, MapPinForm } from "./map-pin-form";

/** The error at the field, in the words of the panel's refusal. */
export const MAP_PIN_UNREADABLE =
  "No coordinates could be read from that, so the pin is unchanged. Enter lat, lon in decimal degrees such as 47.4875, -121.7234, or paste a Google Maps, OpenStreetMap or Apple Maps link that shows the coordinates (short links such as maps.app.goo.gl are not opened). Leave it empty to remove the pin.";

/** The pin was set, but some of what shows it could not be updated. */
export interface MapPinNotes {
  /** What was done: "The map pin of Mailbox Peak is set to 47.4875, -121.7234." */
  done: string;
  /** What failed, as the panel says it. */
  notes: string[];
}

export function MapPinPage({
  user,
  view,
  typed,
  error,
  saved,
}: {
  user: LayoutUser;
  view: WebView;
  /** What was typed, when the form comes back. */
  typed?: string;
  error?: string;
  saved?: MapPinNotes;
}) {
  const hike = view.plannedHike;
  const place = view.hikePlace;
  const server = `/g/${view.server.id}`;
  return (
    <Layout
      title={`${error === undefined ? "" : "Error: "}Set map pin · ${view.server.name} · hikebot`}
      user={user}
    >
      <div class="stack stack--section">
        {error !== undefined && (
          <ErrorSummary
            title="The map pin was not set."
            errors={[{ field: MAP_PIN_FIELD, message: error }]}
          />
        )}
        <BackLink href={server}>Back to {view.server.name}</BackLink>
        <div class="page-heading">
          <p class="page-heading__eyebrow">Planned hike</p>
          <h1>Set map pin</h1>
          <p class="page-heading__lead">
            Where {hike?.location.label ?? "the hike"} is: its map links, map
            picture and forecast follow the pin, in Discord and here.
          </p>
        </div>
        {saved !== undefined && (
          <Banner tone="warning" title={saved.done}>
            <ul>
              {saved.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Banner>
        )}
        {place?.pin ? (
          <section class="stack stack--tight" aria-labelledby="pin-now">
            <h2 id="pin-now">The pin now</h2>
            <MapLinks place={place.pin} />
          </section>
        ) : (
          <p>
            {place?.lookingUp
              ? "The map pin is being looked up on OpenStreetMap."
              : "This hike has no map pin."}
          </p>
        )}
        {place !== null && (
          <MapPinForm
            guildId={view.server.id}
            roundId={place.roundId}
            csrf={user.csrf}
            value={typed ?? place.pin?.text ?? ""}
            error={error}
            back={server}
          />
        )}
      </div>
    </Layout>
  );
}

/** Why a member cannot set the pin here. */
export type MapPinRefusal = "not_admin" | "not_pinnable";

export function MapPinRefusedPage({
  user,
  view,
  why,
}: {
  user: LayoutUser;
  view: WebView;
  why: MapPinRefusal;
}) {
  return why === "not_admin" ? (
    <MessagePage
      title="Only an admin can set the map pin"
      lead="The hike's map pin is set by the server owner or a member with the admin role, as in /hike admin in Discord."
      action={{ href: `/g/${view.server.id}`, label: "Go to the server" }}
      user={user}
    />
  ) : (
    <MessagePage
      title="There is no hike whose map pin can be set"
      lead="The map pin can be set for the planned hike until the next round decides its location. Its page shows what is planned now."
      action={{ href: `/g/${view.server.id}`, label: "Go to the server" }}
      user={user}
    />
  );
}
