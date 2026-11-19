/**
 * The server's page, after the planned hike's card: where the hike is. Its
 * place name, both map links and OpenStreetMap's credit when it has a map
 * pin, as the hike thread shows them; else that the pin is being looked up,
 * or that there is none. An admin gets Set map pin here when there is none
 * (the form the panel's modal is), and Change map pin when there is one.
 * Nothing while no hike is planned.
 */
import type { WebView } from "../../../guild/web-view";
import { Button } from "../../components/button";
import { MapPinIcon } from "../../components/icons";
import { MapLinks } from "../../components/map-links";
import { MapPinForm } from "./map-pin-form";

export function HikePlace({ view, csrf }: { view: WebView; csrf: string }) {
  const place = view.hikePlace;
  if (place === null) return null;
  const canSet = view.viewer.isAdmin && place.pinnable;
  return (
    <section class="stack" aria-labelledby="hike-place">
      <h2 id="hike-place">Where</h2>
      {place.pin !== null ? (
        <>
          <MapLinks place={place.pin} />
          {canSet && (
            <div class="cluster">
              <Button
                variant="quiet"
                icon={MapPinIcon}
                href={`/g/${view.server.id}/map-pin`}
              >
                Change map pin
              </Button>
            </div>
          )}
        </>
      ) : place.lookingUp ? (
        <p>The map pin is being looked up on OpenStreetMap.</p>
      ) : canSet ? (
        <>
          <p>
            This hike has no map pin, so it has no map links or forecast. You
            are an admin: set one here, or in Discord with /hike admin.
          </p>
          <MapPinForm
            guildId={view.server.id}
            roundId={place.roundId}
            csrf={csrf}
            variant={view.round === null ? "primary" : "secondary"}
          />
        </>
      ) : (
        <p>
          This hike has no map pin, so it has no map links or forecast. An admin
          can set one from /hike admin.
        </p>
      )}
    </section>
  );
}
