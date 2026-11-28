import { describe, expect, it } from "vitest";
import type { Refusal } from "../../../../src/web/pages/server/forms";
import { ProposeLocation } from "../../../../src/web/pages/server/propose-location";
import { render, spokenText } from "../../components/render";
import {
  baseView,
  FORMS,
  GUILD,
  locationProposal,
  MARKUP,
  openVote,
  round,
} from "./view";

function viewWith(propose = locationProposal()) {
  const vote = {
    ...openVote("location", [{ label: "Ridge", votes: 0 }]),
    propose,
  };
  return baseView({ round: round("location_vote_open", vote) });
}

const ACTION = `action="/g/${GUILD}/polls/1/options"`;

describe("ProposeLocation", () => {
  it("shows nothing without an open location vote", () => {
    expect(render(<ProposeLocation view={baseView()} forms={FORMS} />)).toBe(
      "",
    );
    const date = baseView({
      round: round("date_vote_open", openVote("date", []), "Lake"),
    });
    expect(render(<ProposeLocation view={date} forms={FORMS} />)).toBe("");
  });

  it("has the modal's fields, each named, posting to the poll's options", async () => {
    const html = render(<ProposeLocation view={viewWith()} forms={FORMS} />);
    const text = await spokenText(html);
    expect(text).toContain("Propose a location");
    expect(text).not.toContain("earlier round");
    expect(text).not.toContain("New location");
    expect(html).toContain(
      `<form class="stack stack--loose" method="post" ${ACTION} novalidate>`,
    );
    expect(html).toContain('<input type="hidden" name="csrf" value="token"/>');
    expect(html).toMatch(/<label[^>]*for="new-location-name"[^>]*>Name/);
    expect(html).toMatch(
      /id="new-location-name" name="name" type="text"[^>]*maxlength="80"[^>]*required/,
    );
    expect(html).toMatch(/<label[^>]*for="new-location-details"[^>]*>Details/);
    expect(html).toMatch(/<textarea[^>]*name="details"[^>]*maxlength="300"/);
    expect(html).toMatch(
      /<label[^>]*for="new-location-map"[^>]*>Map link or coordinates/,
    );
    expect(text).toContain("Optional: a trail link, the distance, notes");
    expect(text).toContain(
      "Optional: a Google Maps, OpenStreetMap or Apple Maps link, or lat, lon",
    );
    expect(text).toContain("Propose location");
    expect(html).not.toContain("Suggest one again");
    expect(html).not.toContain("button--primary");
  });

  it("makes Propose location the page's primary action while the vote has no locations", () => {
    const vote = { ...openVote("location", []), propose: locationProposal() };
    const html = render(
      <ProposeLocation
        view={baseView({ round: round("location_vote_open", vote) })}
        forms={FORMS}
      />,
    );
    expect(html).toMatch(
      /<button class="button button--primary"[^>]*>.*Propose location/s,
    );
  });

  it("offers past locations to suggest again, and names the resting ones in the bot's words", async () => {
    const html = render(
      <ProposeLocation
        view={viewWith(
          locationProposal({
            again: [
              { optionId: 12, label: "Canyon", details: null },
              { optionId: 13, label: MARKUP, details: null },
            ],
            resting:
              "Resting: **Eagle Peak** (2 more hikes), **Lake** (1 more hike)",
          }),
        )}
        forms={FORMS}
      />,
    );
    const text = await spokenText(html);
    expect(text).toContain("Suggest one again");
    expect(text).toContain(
      "Put one from an earlier round on the vote again, or add a new one.",
    );
    expect(text).toContain("New location");
    expect(html).toMatch(
      /<select[^>]*id="suggest-again-location" name="again"/,
    );
    expect(html).toContain('<option value="12">Canyon</option>');
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
    expect(html).not.toContain("<script>");
    expect(text).toContain("Suggest again");
    expect(html).toContain(
      "Resting: <strong>Eagle Peak</strong> (2 more hikes), <strong>Lake</strong> (1 more hike)",
    );
  });

  it("names the resting ones even with nothing to suggest again", () => {
    const html = render(
      <ProposeLocation
        view={viewWith(
          locationProposal({ resting: "Resting: **Lake** (1 more hike)" }),
        )}
        forms={FORMS}
      />,
    );
    expect(html).toContain("Suggest one again");
    expect(html).not.toContain('name="again"');
    expect(html).toContain("Resting: <strong>Lake</strong> (1 more hike)");
  });

  it("shows the bot's sentence instead of the forms when the vote is full", async () => {
    const html = render(
      <ProposeLocation
        view={viewWith(
          locationProposal({
            refusal:
              "This vote already has 25 locations, the most it can hold. Vote for one of them instead.",
          }),
        )}
        forms={FORMS}
      />,
    );
    expect(html).not.toContain("<form");
    expect(await spokenText(html)).toContain(
      "This vote already has 25 locations, the most it can hold. Vote for one of them instead.",
    );
  });

  it("shows the bot's sentence naming the member's location instead of the forms once they proposed one", async () => {
    const html = render(
      <ProposeLocation
        view={viewWith(
          locationProposal({
            refusal:
              "You've already proposed **Summit** for this location vote. Each member proposes one location per round.",
            again: [{ optionId: 12, label: "Canyon", details: null }],
          }),
        )}
        forms={FORMS}
      />,
    );
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Suggest one again");
    expect(html).toContain("<strong>Summit</strong>");
    expect(await spokenText(html)).toContain(
      "You've already proposed Summit for this location vote. Each member proposes one location per round.",
    );
  });

  it.each([
    [
      "invalid_label",
      "A label must be 1 to 80 characters.",
      "new-location-name",
    ],
    [
      "invalid_details",
      "Details must be at most 300 characters.",
      "new-location-details",
    ],
    [
      "duplicate_option",
      "**Lake** is already on the list. Vote for it instead.",
      "new-location-name",
    ],
    [
      "too_many_options",
      "This vote already has 25 locations, the most it can hold. Vote for one of them instead.",
      "new-location-name",
    ],
    [
      "location_on_cooldown",
      "**Lake** was the hike on Sat, 8 Jun 2030 · 11:00. It can be suggested again after 2 more hikes.",
      "new-location-name",
    ],
    ["poll_closed", "This vote has closed.", "new-location-name"],
    ["unavailable", "This action is no longer available.", "new-location-name"],
  ])(
    "shows %s with the bot's sentence, on its field, and keeps what was typed",
    async (code, message, field) => {
      const refusal: Refusal = {
        form: "location",
        pollId: 1,
        code,
        message,
        name: "Lake",
        details: "Loop, 8 km",
        map: "https://maps.app.goo.gl/abc",
      };
      const html = render(
        <ProposeLocation
          view={viewWith()}
          forms={{ csrf: "token", refusal }}
        />,
      );
      const text = await spokenText(html);
      const sentence = message.replaceAll("**", "");
      expect(text).toContain(`Error Your location was not added. ${sentence}`);
      expect(html).toContain(`href="#${field}"`);
      expect(html).toMatch(new RegExp(`id="${field}"[^>]*aria-invalid="true"`));
      expect(html).toContain('value="Lake"');
      expect(html).toContain(">Loop, 8 km</textarea>");
      expect(html).toContain('value="https://maps.app.goo.gl/abc"');
    },
  );

  it.each([
    [
      "location_on_cooldown",
      "**Lake** was the hike on Sat, 8 Jun 2030 · 11:00. It can be suggested again after 2 more hikes.",
    ],
    ["unavailable", "This action is no longer available."],
  ])(
    "shows a refused suggestion (%s) on the select, the pick kept",
    async (code, message) => {
      const html = render(
        <ProposeLocation
          view={viewWith(
            locationProposal({
              again: [
                { optionId: 12, label: "Canyon", details: null },
                { optionId: 13, label: "Lake", details: null },
              ],
            }),
          )}
          forms={{
            csrf: "token",
            refusal: { form: "again", pollId: 1, code, message, optionId: 13 },
          }}
        />,
      );
      expect(await spokenText(html)).toContain(
        `Error The location was not added. ${message.replaceAll("**", "")}`,
      );
      expect(html).toContain('<option value="13" selected>Lake</option>');
      expect(html).not.toContain("Your location was not added.");
    },
  );
});
