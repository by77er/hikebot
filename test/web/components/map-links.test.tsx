import { describe, expect, it } from "vitest";
import { MapLinks, OsmCredit } from "../../../src/web/components/map-links";
import { render, spokenText } from "./render";

const PLACE = {
  name: "Lake Serene, Snohomish County",
  text: "47.8, -121.57",
  osmUrl:
    "https://www.openstreetmap.org/?mlat=47.8&mlon=-121.57#map=13/47.8/-121.57",
  googleUrl: "https://www.google.com/maps/search/?api=1&query=47.8,-121.57",
};

describe("MapLinks", () => {
  it("names the place, links it on both maps and credits OpenStreetMap", async () => {
    const html = render(<MapLinks place={PLACE} />);
    expect(await spokenText(html)).toBe(
      "Lake Serene, Snohomish County 47.8, -121.57 Open in OpenStreetMap Open in Google Maps © OpenStreetMap contributors",
    );
    expect(html).toContain(`href="${PLACE.osmUrl.replace(/&/g, "&amp;")}"`);
    expect(html).toContain(`href="${PLACE.googleUrl.replace(/&/g, "&amp;")}"`);
    expect(html).not.toMatch(/<(img|iframe|script)/);
  });

  it("shows the coordinates when the place has no name", async () => {
    expect(
      await spokenText(render(<MapLinks place={{ ...PLACE, name: null }} />)),
    ).toMatch(/^47\.8, -121\.57 Open in OpenStreetMap/);
  });

  it("is one line in a vote's row, its link named after the option", async () => {
    const html = render(
      <MapLinks place={PLACE} variant="compact" label="Lake" />,
    );
    expect(await spokenText(html)).toBe(
      "Lake Serene, Snohomish County · Map of Lake",
    );
    expect(
      await spokenText(
        render(
          <MapLinks
            place={{ ...PLACE, name: null }}
            variant="compact"
            label="Lake"
          />,
        ),
      ),
    ).toBe("Map of Lake");
  });

  it("gives the compact Map link a whole touch target only when it stands alone", () => {
    const alone = render(
      <MapLinks
        place={{ ...PLACE, name: null }}
        variant="compact"
        label="Lake"
      />,
    );
    expect(alone).toContain('class="u-target"');
    expect(
      render(<MapLinks place={PLACE} variant="compact" label="Lake" />),
    ).not.toContain("u-target");
  });

  it("puts a name with markup in it as text", () => {
    const html = render(
      <MapLinks place={{ ...PLACE, name: "<script>alert(1)</script>" }} />,
    );
    expect(html).not.toContain("<script");
  });

  it("credits OpenStreetMap with a link to its copyright page", async () => {
    const html = render(<OsmCredit />);
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(await spokenText(html)).toBe("© OpenStreetMap contributors");
  });
});
