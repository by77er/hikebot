/**
 * The server's page, in the planned hike's card: the map of the hike's
 * pin, with the place's name on it and its coordinates under it, which the
 * card shows above its links. Without JavaScript, the map picture the
 * hike's thread and event show (`/g/<guild id>/map.png`). Nothing while the
 * hike has no pin or no picture (no map data there, or not drawn yet).
 */
import type { VNode } from "preact";
import type { WebView } from "../../../guild/web-view";
import { coordinates, MapView } from "../../components/map-view";

/** The map for the planned hike's card, or undefined for none. */
export function hikeMap(view: WebView): VNode | undefined {
  const hike = view.plannedHike;
  const pin = view.hikePlace?.pin ?? null;
  if (hike === null || pin === null || hike.mapPictureKey === null) {
    return undefined;
  }
  const label = hike.location.label;
  const point = { lat: pin.lat, lon: pin.lon };
  return (
    <MapView
      title={`Map of ${label}`}
      markers={[{ ...point, label }]}
      picture={`/g/${view.server.id}/map.png`}
      caption={`${label}: ${coordinates(point)}`}
      framed={false}
    />
  );
}
