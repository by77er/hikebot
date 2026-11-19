/**
 * Style guide: Map links, with a place name, with coordinates only, at the
 * longest place name, and compact as in a vote's row.
 */
import { MapLinks, OsmCredit, type MapPlace } from "../../components/map-links";
import { Section, type StyleguideSection } from "./section";

const NAMED: MapPlace = {
  name: "Mailbox Peak, King County",
  text: "47.4669, -121.6746",
  osmUrl:
    "https://www.openstreetmap.org/?mlat=47.4669&mlon=-121.6746#map=13/47.4669/-121.6746",
  googleUrl:
    "https://www.google.com/maps/search/?api=1&query=47.4669,-121.6746",
};

const GIVEN: MapPlace = {
  name: null,
  text: "46.78591, -121.73532",
  osmUrl:
    "https://www.openstreetmap.org/?mlat=46.78591&mlon=-121.73532#map=13/46.78591/-121.73532",
  googleUrl:
    "https://www.google.com/maps/search/?api=1&query=46.78591,-121.73532",
};

const LONGEST: MapPlace = {
  ...NAMED,
  name: "Snoqualmie Pass Wagon Road Trailhead, Snoqualmie Pass, Kittitas Count",
};

function MapLinksSection() {
  return (
    <Section
      id="map-links"
      title="Map links"
      intro="Where a location is, as the bot shows it: its place name, links to it on OpenStreetMap and Google Maps, and OpenStreetMap's credit. Plain links: no map is loaded from those sites."
    >
      <h3>With a place name</h3>
      <MapLinks place={NAMED} />
      <h3>With coordinates someone gave, and no name</h3>
      <MapLinks place={GIVEN} />
      <h3>At the longest place name</h3>
      <MapLinks place={LONGEST} />
      <h3>Compact, in a vote's row, then the list's credit</h3>
      <div class="stack stack--tight">
        <MapLinks place={NAMED} variant="compact" label="Mailbox Peak" />
        <MapLinks place={GIVEN} variant="compact" label="Paradise" />
        <OsmCredit />
      </div>
    </Section>
  );
}

export const mapLinksSection: StyleguideSection = {
  id: "map-links",
  title: "Map links",
  render: MapLinksSection,
  ownPage: true,
};
