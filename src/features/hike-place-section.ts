/**
 * Where the planned hike is, in the web view (`src/guild/web-view.ts`): the
 * map pin of its decided location with its place name and links to it on
 * OpenStreetMap and Google Maps, as the hike thread shows them, whether the
 * pin is still being looked up, and whether Set map pin can still change
 * it. `webMapPin` gives the same for a location option of an open vote.
 */
import { googleLink, osmLink, formatPoint } from "../geo/links";
import type { WebViewSource } from "../guild/web-view";
import type { OptionPlace, RoundView } from "../polls/store";
import { pinnableRound } from "./map-pin";
import { plannedHikeSection } from "./planned-hike-section";

/** A location's map pin and the links to it. */
export interface WebMapPin {
  lat: number;
  lon: number;
  /** The pin as the Set map pin form shows it: `47.4875, -121.7234`. */
  text: string;
  /** The geocoder's short place name; null for coordinates someone gave. */
  name: string | null;
  /** The pin on openstreetmap.org, with a marker. */
  osmUrl: string;
  /** The pin on Google Maps. */
  googleUrl: string;
}

export interface WebHikePlace {
  roundId: number;
  /** The decided location's pin; null when it has none. */
  pin: WebMapPin | null;
  /** True while the pin is still being looked up on OpenStreetMap. */
  lookingUp: boolean;
  /**
   * Whether Set map pin can change this hike's pin: false once a newer
   * round has decided its location, as in the admin panel.
   */
  pinnable: boolean;
}

/** The pin of a location's place, or null when it has no point. */
export function webMapPin(place: OptionPlace | null): WebMapPin | null {
  const point = place?.point ?? null;
  if (place === null || point === null) return null;
  return {
    lat: point.lat,
    lon: point.lon,
    text: formatPoint(point),
    name: place.name,
    osmUrl: osmLink(point),
    googleUrl: googleLink(point),
  };
}

function decidedPlace(round: RoundView): OptionPlace | null {
  return (
    round.locationPoll?.options.find(
      (option) => option.id === round.locationOptionId,
    )?.place ?? null
  );
}

/** Where the planned hike is; null with no planned hike. */
export function hikePlaceSection(source: WebViewSource): WebHikePlace | null {
  const planned = plannedHikeSection(source);
  const round = planned && source.store.getRound(planned.roundId);
  if (!round) return null;
  const place = decidedPlace(round);
  return {
    roundId: round.id,
    pin: webMapPin(place),
    lookingUp: place?.status === "pending",
    pinnable: pinnableRound(source.store)?.id === round.id,
  };
}
