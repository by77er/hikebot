/**
 * Map links: where a location is, as the bot shows it, with links to the
 * place on public maps. `full`, for a planned hike: the place name (or the
 * pin's coordinates when it has none) with a map pin, the coordinates under
 * a name, and Open in OpenStreetMap and Open in Google Maps as quiet
 * buttons, then OpenStreetMap's credit. `compact`, for an option of a
 * vote, as the poll message does: the place name and a Map link in one
 * small line, named after the option; the list it is in carries the credit
 * once (`OsmCredit`). Plain links: nothing is loaded from the map sites.
 * Built from the layout classes, the utilities and Button, so it has no
 * stylesheet of its own.
 */
import { Button } from "./button";
import { ExternalLinkIcon, MapPinIcon } from "./icons";

/** A location's pin, as the web view gives it. */
export interface MapPlace {
  /** The geocoder's short place name; null for coordinates someone gave. */
  name: string | null;
  /** The coordinates: `47.4875, -121.7234`. */
  text: string;
  osmUrl: string;
  googleUrl: string;
}

/** Where OpenStreetMap asks its credit to link. */
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

/** OpenStreetMap's credit, owed wherever its data is shown. */
export function OsmCredit() {
  return (
    <p class="u-small u-muted">
      © <a href={OSM_COPYRIGHT_URL}>OpenStreetMap contributors</a>
    </p>
  );
}

export function MapLinks({
  place,
  variant = "full",
  label,
}: {
  place: MapPlace;
  /** Defaults to `full`. */
  variant?: "full" | "compact";
  /** What the place is, for the compact link's name: "Lake Serene". */
  label?: string;
}) {
  if (variant === "compact") {
    return (
      <p class="cluster cluster--tight cluster--nowrap u-small u-muted">
        <MapPinIcon size="small" />
        <span>
          {place.name !== null && <>{place.name} · </>}
          <a href={place.osmUrl}>
            Map
            {label !== undefined && (
              <span class="u-visually-hidden"> of {label}</span>
            )}
          </a>
        </span>
      </p>
    );
  }
  return (
    <div class="stack stack--tight">
      <p class="cluster cluster--tight cluster--nowrap">
        <MapPinIcon />
        <strong>{place.name ?? place.text}</strong>
      </p>
      {place.name !== null && <p class="u-small u-muted">{place.text}</p>}
      <div class="cluster">
        <Button
          variant="quiet"
          href={place.osmUrl}
          iconAfter={ExternalLinkIcon}
        >
          Open in OpenStreetMap
        </Button>
        <Button
          variant="quiet"
          href={place.googleUrl}
          iconAfter={ExternalLinkIcon}
        >
          Open in Google Maps
        </Button>
      </div>
      <OsmCredit />
    </div>
  );
}
