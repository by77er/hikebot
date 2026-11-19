import { describe, expect, it } from "vitest";
import { PlannedHike } from "../../../../src/web/pages/server/planned-hike";
import { render, spokenText } from "../../components/render";
import { baseView, MARKUP, plannedHike, TIME_ZONE } from "./view";

describe("PlannedHike", () => {
  it("shows the hike card with its time in the server's zone and its links", async () => {
    const hike = plannedHike();
    const html = render(<PlannedHike view={baseView({ plannedHike: hike })} />);
    const text = await spokenText(html);
    expect(text).toContain("Planned hike");
    expect(text).toContain("Mailbox Peak");
    expect(text).toContain("Bring poles.");
    expect(text).toContain(`Sat, 15 Jun 2030 · 09:00 ${TIME_ZONE}`);
    expect(text).toContain("Planned");
    expect(html).toContain(`href="${hike.threadUrl ?? ""}"`);
    expect(html).toContain(`href="${hike.eventUrl ?? ""}"`);
    expect(text).toContain("Hike thread");
    expect(text).toContain("Hike event");
  });

  it("leaves out the links the hike does not have", async () => {
    const hike = plannedHike({ threadUrl: null, eventUrl: null });
    const text = await spokenText(
      render(<PlannedHike view={baseView({ plannedHike: hike })} />),
    );
    expect(text).not.toContain("Hike thread");
    expect(text).not.toContain("Hike event");
  });

  it("shows nothing while no hike is planned", () => {
    expect(render(<PlannedHike view={baseView()} />)).toBe("");
  });

  it("shows a location and details with markup in them as text", () => {
    const hike = plannedHike({
      location: { label: MARKUP, details: MARKUP, proposedBy: "1" },
    });
    const html = render(<PlannedHike view={baseView({ plannedHike: hike })} />);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
  });
});
