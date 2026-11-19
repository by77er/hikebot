import { describe, expect, it } from "vitest";
import { ServerPage } from "../../../../src/web/pages/server/page";
import { htmlResponse } from "../../../../src/web/response";
import { outline } from "../../helpers";
import {
  adminAction,
  asAdmin,
  baseView,
  FORMS,
  logSection,
  MARKUP,
  openVote,
  plannedHike,
  round,
} from "./view";

const USER = { name: "Ana", avatar: null, csrf: "token" };

async function page(view: Parameters<typeof ServerPage>[0]["view"]) {
  const html = await htmlResponse(
    <ServerPage user={USER} view={view} forms={FORMS} />,
  ).text();
  return { html, page: await outline(html) };
}

/** The first words of each section of the page, in order. */
async function sections(html: string): Promise<string[]> {
  const words: string[] = [];
  let depth = 0;
  await new HTMLRewriter()
    .on("div.stack--section > *", {
      element(element) {
        words.push("");
        depth += 1;
        element.onEndTag(() => {
          depth -= 1;
        });
      },
    })
    .onDocument({
      text(chunk) {
        const last = words.pop();
        if (last !== undefined) {
          words.push(depth > 0 ? last + chunk.text : last);
        }
      },
    })
    .transform(new Response(html))
    .text();
  return words.map((text) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    return SECTION_STARTS.find((start) => trimmed.startsWith(start)) ?? trimmed;
  });
}

const SECTION_STARTS = [
  "Switch server",
  "Hike planned.",
  "Location vote",
  "Admin",
  "Planned hike",
  "Hike log",
  "Calendar",
];

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

  it("puts the map of an open location vote right after the vote", async () => {
    const { page: shown } = await page(
      baseView({
        round: round(
          "location_vote_open",
          openVote("location", [
            { label: "Lake", votes: 1, point: { lat: 47.5, lon: -121.7 } },
          ]),
        ),
        plannedHike: plannedHike(),
      }),
    );
    const order = [
      "Location vote",
      "Proposed locations on the map",
      "Planned hike",
    ].map((words) => shown.text.indexOf(words));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The map's own script, from this site; nothing inline.
    expect(shown.scripts).toBe(1);
    expect(shown.styleAttributes).toBe(0);
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

  it("puts an admin's notice right after the heading and the Admin card after the current step", async () => {
    const thread = adminAction("create-hike-thread");
    const view = asAdmin(
      baseView({
        round: round(
          "location_vote_open",
          openVote("location", [{ label: "Lake", votes: 1 }]),
        ),
        plannedHike: plannedHike(),
        log: logSection(6, 1, 5),
      }),
      [thread, adminAction("close-vote"), adminAction("cancel-round")],
    );
    const html = await htmlResponse(
      <ServerPage
        user={USER}
        view={view}
        notice={{ kind: "done", lines: ["Hike planned."], retries: [thread] }}
        forms={FORMS}
      />,
    ).text();
    expect(await sections(html)).toEqual([
      "Switch server",
      expect.stringMatching(/^Done, but a step failed\./),
      "Location vote",
      "Admin",
      expect.stringMatching(/^Propose a location/),
      "Planned hike",
      "Hike log",
      "Calendar",
    ]);
    expect((await outline(html)).scripts).toBe(0);
  });

  it("shows no Admin card to a member", async () => {
    const { html } = await page(baseView({ plannedHike: plannedHike() }));
    expect(html).not.toContain(">Admin</h2>");
    expect(html).not.toContain("/admin/");
  });

  it("gives the Admin card exactly one primary button", async () => {
    const view = asAdmin(
      baseView({
        round: round(
          "location_vote_open",
          openVote("location", [{ label: "Lake", votes: 1 }]),
        ),
      }),
      [adminAction("close-vote"), adminAction("cancel-round")],
    );
    const { html } = await page(view);
    const card = html.slice(
      html.lastIndexOf("<article", html.indexOf(">Admin</h2>")),
    );
    const end = card.indexOf("</article>");
    expect([...card.slice(0, end).matchAll(/button--primary/g)]).toHaveLength(
      1,
    );
  });
});
