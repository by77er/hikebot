import { describe, expect, it } from "vitest";
import { ServerPage } from "../../../../src/web/pages/server/page";
import { htmlResponse } from "../../../../src/web/response";
import { outline } from "../../helpers";
import {
  baseView,
  logSection,
  MARKUP,
  openVote,
  plannedHike,
  round,
} from "./view";

const USER = { name: "Ana", avatar: null, csrf: "token" };

async function page(view: Parameters<typeof ServerPage>[0]["view"]) {
  const html = await htmlResponse(
    <ServerPage user={USER} view={view} />,
  ).text();
  return { html, page: await outline(html) };
}

describe("ServerPage", () => {
  it("puts its sections in order: heading, current step, planned hike, log, calendar", async () => {
    const { page: shown } = await page(
      baseView({
        round: round(
          "location_vote_open",
          openVote("location", [{ label: "Lake", votes: 1 }]),
        ),
        plannedHike: plannedHike(),
        log: logSection(6, 1, 5),
      }),
    );
    const order = [
      "Switch server",
      "Location vote",
      "Planned hike",
      "Hike log",
      "Calendar address",
    ].map((words) => shown.text.indexOf(words));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(shown.title).toBe("Ridge Walkers · hikebot");
    expect(shown.scripts).toBe(0);
  });

  it("has one h1 and one primary action", async () => {
    const { html } = await page(
      baseView({
        round: round(
          "location_vote_open",
          openVote("location", [{ label: "Lake", votes: 1 }]),
        ),
      }),
    );
    expect([...html.matchAll(/<h1/g)]).toHaveLength(1);
    expect([...html.matchAll(/button--primary/g)]).toHaveLength(1);
  });

  it("puts text from Discord and members into the page as text", async () => {
    const view = baseView({
      round: round(
        "location_vote_open",
        openVote("location", [{ label: MARKUP, votes: 1, details: MARKUP }]),
      ),
      plannedHike: plannedHike({
        location: { label: MARKUP, details: MARKUP, proposedBy: "1" },
      }),
    });
    const { page: shown } = await page({
      ...view,
      server: { ...view.server, name: MARKUP },
    });
    expect(shown.scripts).toBe(0);
    // HTMLRewriter reads text as it is written in the HTML, escaped.
    expect(shown.text).toContain(
      "&lt;script>alert(1)&lt;/script>&lt;b>Ridge&lt;/b>",
    );
    expect(shown.elements).not.toContain("b");
  });
});
