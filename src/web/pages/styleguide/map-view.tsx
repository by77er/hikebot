/**
 * Style guide: Map view, on a page of its own at `/styleguide/map-view`.
 * The hike's pin over its stored picture, as a planned hike's card shows
 * it, and numbered places with their list, as an open location vote shows
 * them; both round the sample point of the committed map data, so they
 * draw wherever that data is (`maps/sample/`).
 */
import regions from "../../../../maps/regions.json";
import { assetPath } from "../../assets";
import { coordinates, MapView } from "../../components/map-view";
import { MAP_SAMPLES_DIR } from "./map";
import { Section, type StyleguideSection } from "./section";

const { lat, lon } = regions.samplePoint;

const PLACES = [
  { label: "Mount Si", lat: 47.5069, lon: -121.739 },
  { label: "Little Si", lat: 47.4987, lon: -121.756 },
  { label: "Crater Lake Peak", lat: 47.5184, lon: -121.7294 },
];

function MapViewSection() {
  return (
    <Section
      id="map-view"
      title="Map view"
      intro="A map drawn in the browser from hikebot's own map data, in the Cairn map style. The pin is the blaze with the place's name; several places are numbered, with their list under the map. Without JavaScript the stored picture shows in the same frame. The map keeps its light look in the dark scheme, inside its frame."
    >
      <h3>A hike's pin, over its picture, with its coordinates</h3>
      <MapView
        title="Map of the Mount Si trailhead"
        markers={[{ lat, lon, label: "Mount Si trailhead" }]}
        picture={assetPath(`${MAP_SAMPLES_DIR}/trailhead-z12.png`)}
        caption={`Mount Si trailhead: ${coordinates({ lat, lon })}`}
      />
      <h3>Numbered places, with their list</h3>
      <MapView
        title="Map of the proposed locations"
        markers={PLACES.map((place, index) => ({
          ...place,
          number: index + 1,
        }))}
      />
    </Section>
  );
}

export const mapViewSection: StyleguideSection = {
  id: "map-view",
  title: "Map view",
  render: MapViewSection,
  ownPage: true,
};
