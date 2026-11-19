import { describe, expect, it } from "vitest";
import { HikePlace } from "../../../../src/web/pages/server/hike-place";
import { render, spokenText } from "../../components/render";
import {
  baseView,
  GUILD,
  hikePlace,
  mapPin,
  MARKUP,
  plannedHike,
} from "./view";

function shown(place: ReturnType<typeof hikePlace>, isAdmin = false): string {
  const view = baseView({ plannedHike: plannedHike(), hikePlace: place });
  return render(
    <HikePlace
      view={{ ...view, viewer: { ...view.viewer, isAdmin } }}
      csrf="csrf-token"
    />,
  );
}

describe("HikePlace", () => {
  it("shows the place name, both map links and OpenStreetMap's credit", async () => {
    const html = shown(hikePlace());
    const text = await spokenText(html);
    expect(text).toBe(
      "Where Mailbox Peak, King County 47.4669, -121.6746 Open in OpenStreetMap Open in Google Maps © OpenStreetMap contributors",
    );
    expect(html).toContain(`href="${mapPin().osmUrl.replace(/&/g, "&amp;")}"`);
    expect(html).toContain(
      `href="${mapPin().googleUrl.replace(/&/g, "&amp;")}"`,
    );
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(html).not.toContain("<form");
  });

  it("shows the coordinates of a pin without a place name", async () => {
    const text = await spokenText(shown(hikePlace({ pin: mapPin(null) })));
    expect(text).toContain("Where 47.4669, -121.6746 Open in OpenStreetMap");
  });

  it("offers an admin Change map pin", () => {
    expect(shown(hikePlace(), true)).toContain(`href="/g/${GUILD}/map-pin"`);
  });

  it("says the pin is being looked up", async () => {
    const text = await spokenText(
      shown(hikePlace({ pin: null, lookingUp: true }), true),
    );
    expect(text).toBe("Where The map pin is being looked up on OpenStreetMap.");
  });

  it("tells a member there is no map pin, with no form", async () => {
    const html = shown(hikePlace({ pin: null }));
    expect(await spokenText(html)).toBe(
      "Where This hike has no map pin, so it has no map links or forecast. An admin can set one from /hike admin.",
    );
    expect(html).not.toContain("<form");
  });

  it("gives an admin the Set map pin form, posting to the server's map pin with the token and the hike's round", () => {
    const html = shown(hikePlace({ pin: null }), true);
    expect(html).toContain(`action="/g/${GUILD}/map-pin"`);
    expect(html).toContain('method="post"');
    expect(html).toContain('name="csrf" value="csrf-token"');
    expect(html).toContain('name="round" value="12"');
    expect(html).toContain('name="point"');
    expect(html).toContain("Set map pin");
    expect(html).toContain("button--primary");
  });

  it("gives no form when the hike can no longer be pinned", () => {
    const html = shown(hikePlace({ pin: null, pinnable: false }), true);
    expect(html).not.toContain("<form");
  });

  it("shows a place name with markup in it as text", () => {
    const html = shown(hikePlace({ pin: mapPin(MARKUP) }));
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script>");
  });

  it("shows nothing while no hike is planned", () => {
    expect(render(<HikePlace view={baseView()} csrf="t" />)).toBe("");
  });
});
