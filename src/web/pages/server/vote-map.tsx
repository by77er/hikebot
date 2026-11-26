/**
 * The server's page, after the current step: while the location vote is
 * open, the proposed locations that have a place, on one map fitted to
 * them, numbered in the vote's order, with the numbered list of their
 * names and coordinates under it. Without JavaScript the map's frame says
 * "Turn on JavaScript to see the map.", with the list under it.
 * Nothing while no location vote is open or no option has a place.
 */
import type { WebView } from "../../../guild/web-view";
import { MapView, type MapMarker } from "../../components/map-view";

export function VoteMap({ view }: { view: WebView }) {
  const round = view.round;
  if (round?.step !== "location_vote_open" || round.vote === null) return null;
  const markers: MapMarker[] = [];
  for (const option of round.vote.options) {
    if (option.place === null) continue;
    markers.push({
      lat: option.place.lat,
      lon: option.place.lon,
      label: option.label,
      number: markers.length + 1,
    });
  }
  if (markers.length === 0) return null;
  return (
    <section class="stack" aria-labelledby="vote-map">
      <h2 id="vote-map">Proposed locations on the map</h2>
      <MapView title="Map of the proposed locations" markers={markers} />
    </section>
  );
}
