/**
 * Set map pin for a server's planned hike, at
 * `/g/<guild id>/admin/set-map-pin`, for an admin: the form the panel's
 * modal is, filled with the current pin or what was typed, under where the
 * pin is now. A form that could not be read comes back with the panel's
 * sentence at the field and in the summary.
 */
import type { WebView } from "../../../guild/web-view";
import { BackLink } from "../../components/back-link";
import { ErrorSummary } from "../../components/error-summary";
import { MapLinks } from "../../components/map-links";
import { Layout, type LayoutUser } from "../../layout";
import { MAP_PIN_FIELD, MapPinForm } from "./map-pin-form";

export function MapPinPage({
  user,
  view,
  typed,
  error,
}: {
  user: LayoutUser;
  view: WebView;
  /** What was typed, when the form comes back. */
  typed?: string;
  /** The panel's refusal; its Discord code marks are dropped. */
  error?: string;
}) {
  const shownError = error?.replace(/`/g, "");
  const hike = view.plannedHike;
  const place = view.hikePlace;
  const server = `/g/${view.server.id}`;
  return (
    <Layout
      title={`${shownError === undefined ? "" : "Error: "}Set map pin · ${view.server.name} · hikebot`}
      user={user}
    >
      <div class="stack stack--section">
        {shownError !== undefined && (
          <ErrorSummary
            title="The map pin was not set."
            errors={[{ field: MAP_PIN_FIELD, message: shownError }]}
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
            error={shownError}
            back={server}
          />
        )}
      </div>
    </Layout>
  );
}
