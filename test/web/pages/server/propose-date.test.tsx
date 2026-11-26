import { describe, expect, it } from "vitest";
import { ProposeDate } from "../../../../src/web/pages/server/propose-date";
import { render, spokenText } from "../../components/render";
import {
  baseView,
  dateProposal,
  FORMS,
  GUILD,
  openVote,
  round,
  TIME_ZONE,
} from "./view";

function viewWith(propose = dateProposal()) {
  const vote = {
    ...openVote("date", [{ label: "Sat, 8 Jun 2030 · 11:00", votes: 0 }]),
    propose,
  };
  return baseView({ round: round("date_vote_open", vote, "Lake") });
}

describe("ProposeDate", () => {
  it("shows nothing without an open date vote", () => {
    const location = baseView({
      round: round("location_vote_open", openVote("location", [])),
    });
    expect(render(<ProposeDate view={location} forms={FORMS} />)).toBe("");
  });

  it("has a date limited to the days a member may propose and an optional time", async () => {
    const html = render(<ProposeDate view={viewWith()} forms={FORMS} />);
    const text = await spokenText(html);
    expect(text).toContain("Propose a date");
    expect(html).toContain(
      `<form class="stack stack--loose" method="post" action="/g/${GUILD}/polls/1/options" novalidate>`,
    );
    expect(html).toContain('<input type="hidden" name="csrf" value="token"/>');
    expect(html).toMatch(/<label[^>]*for="propose-date-day"[^>]*>Date/);
    expect(html).toMatch(
      /id="propose-date-day" name="date" type="date"[^>]*min="2030-06-01" max="2030-07-02" required/,
    );
    expect(text).toContain("2030-06-01 to 2030-07-02.");
    expect(html).toMatch(/<label[^>]*for="propose-date-time"[^>]*>Time/);
    expect(html).toMatch(/id="propose-date-time" name="time" type="time"/);
    expect(html).not.toMatch(/id="propose-date-time"[^>]*required/);
    expect(text).toContain(
      `Optional, in ${TIME_ZONE}; the time defaults to 11:00.`,
    );
    expect(text).toContain("Propose date");
  });

  it("shows the bot's sentence instead of the form when no date can be added", async () => {
    const html = render(
      <ProposeDate
        view={viewWith(
          dateProposal({
            refusal: "This round's dates, up to 2030-05-30, have passed.",
          }),
        )}
        forms={FORMS}
      />,
    );
    expect(html).not.toContain("<form");
    expect(await spokenText(html)).toContain(
      "This round's dates, up to 2030-05-30, have passed.",
    );
  });

  it.each([
    ["invalid_date", "Pick a date."],
    [
      "invalid_date",
      "`2030-06-09 25:00` is not a date. Write it as `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` (24-hour), for example `2026-12-05` or `2026-12-05 09:00`.",
    ],
    [
      "date_in_past",
      "Fri, 31 May 2030 · 11:00 is in the past: today is 2030-06-01 in America/Los_Angeles. Propose a day from 2030-06-01 to 2030-07-02.",
    ],
    [
      "date_too_far",
      "Wed, 3 Jul 2030 · 11:00 is more than 31 days away. Propose a day from 2030-06-01 to 2030-07-02, or ask an admin to plan further ahead.",
    ],
    [
      "date_outside_window",
      "Sun, 2 Jun 2030 · 11:00 is outside this round's dates. Propose a day from 2030-06-08 to 2030-06-21: the 14 days after the date vote closes.",
    ],
    [
      "duplicate_option",
      "**Sat, 8 Jun 2030 · 11:00** is already on the vote. Vote for it instead, or propose another time that day.",
    ],
    [
      "too_many_options",
      "This vote already has 25 dates, the most it can hold. Vote for one of them instead.",
    ],
    ["poll_closed", "This vote has closed."],
    ["invalid_state", "This action is no longer available."],
  ])(
    "shows %s with the bot's sentence on the date, and keeps what was sent",
    async (code, message) => {
      const html = render(
        <ProposeDate
          view={viewWith()}
          forms={{
            csrf: "token",
            refusal: {
              form: "date",
              pollId: 1,
              code,
              message,
              date: "2030-06-09",
              time: "25:00",
            },
          }}
        />,
      );
      const text = await spokenText(html);
      const sentence = message.replaceAll("**", "").replaceAll("`", "");
      expect(text).toContain(`Error Your date was not added. ${sentence}`);
      expect(html).toContain('href="#propose-date-day"');
      expect(html).toMatch(/id="propose-date-day"[^>]*aria-invalid="true"/);
      expect(html).toMatch(/id="propose-date-day"[^>]*value="2030-06-09"/);
      expect(html).toMatch(/id="propose-date-time"[^>]*value="25:00"/);
      if (message.includes("`")) expect(html).toContain("<code>");
    },
  );
});
