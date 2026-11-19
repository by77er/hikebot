import { describe, expect, it } from "vitest";
import { hikeMap } from "../../../../src/web/pages/server/hike-map";
import { PlannedHike } from "../../../../src/web/pages/server/planned-hike";
import { render, spokenText } from "../../components/render";
import { baseView, GUILD, MARKUP, plannedHike } from "./view";

const POINT = { lat: 47.4881, lon: -121.7232 };

describe("hikeMap", () => {
  it("is the map of the hike's pin, over its picture, with its coordinates", async () => {
    const view = baseView({
      plannedHike: plannedHike({
        point: POINT,
        mapPictureKey: "pictures/a.png",
      }),
    });
    const map = hikeMap(view);
    if (!map) throw new Error("no map");
    const html = render(map);
    expect(html).toContain(`src="/g/${GUILD}/map.png"`);
    expect(html).toContain('alt="Map of Mailbox Peak"');
    expect(await spokenText(html)).toContain(
      "Mailbox Peak: 47.4881° N, 121.7232° W",
    );
  });

  it("sits in the planned hike's card, above its links", () => {
    const view = baseView({
      plannedHike: plannedHike({
        point: POINT,
        mapPictureKey: "pictures/a.png",
      }),
    });
    const html = render(<PlannedHike view={view} />);
    const map = html.indexOf('class="hike-card__picture"');
    const links = html.indexOf('class="hike-card__links"');
    expect(map).toBeGreaterThan(0);
    expect(links).toBeGreaterThan(map);
  });

  it("is nothing without a pin, without a picture, or without a planned hike", () => {
    for (const hike of [
      plannedHike({ point: null, mapPictureKey: "pictures/a.png" }),
      plannedHike({ point: POINT, mapPictureKey: null }),
      null,
    ]) {
      const view = baseView({ plannedHike: hike });
      expect(hikeMap(view)).toBeUndefined();
      if (hike) {
        expect(render(<PlannedHike view={view} />)).not.toContain(
          "hike-card__picture",
        );
      }
    }
  });

  it("puts a name with markup in it in as text", () => {
    const view = baseView({
      plannedHike: plannedHike({
        location: { label: MARKUP, details: null, proposedBy: "1" },
        point: POINT,
        mapPictureKey: "pictures/a.png",
      }),
    });
    const map = hikeMap(view);
    if (!map) throw new Error("no map");
    const html = render(map);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<b>");
  });
});
