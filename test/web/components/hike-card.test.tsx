import { describe, expect, it } from "vitest";
import { outline } from "../helpers";
import { dayParts, HikeCard } from "../../../src/web/components/hike-card";
import { render, spokenText } from "./render";

const START = {
  date: "2026-12-05",
  time: "11:00",
  timeZone: "America/Los_Angeles",
};

const LINKS = {
  thread: "https://discord.com/channels/1/2",
  event: "https://discord.com/events/1/3",
  calendar: "/calendar/1/sig.ics",
  map: "https://www.openstreetmap.org/?mlat=47.4&mlon=-121.7",
};

describe("dayParts", () => {
  it("names the weekday and month of a calendar day", () => {
    expect(dayParts("2026-12-05")).toEqual({
      weekday: "Sat",
      day: "5",
      month: "Dec",
      year: "2026",
    });
    expect(dayParts("2030-01-31").weekday).toBe("Thu");
    expect(dayParts("2028-02-29")).toMatchObject({
      weekday: "Tue",
      month: "Feb",
    });
  });
});

describe("HikeCard", () => {
  it("is an article named by the location, with the date block, details and links", async () => {
    const html = render(
      <HikeCard
        location="Mailbox Peak"
        details="Old trail up, new trail down."
        proposer="Ana"
        start={START}
        when="upcoming"
        links={LINKS}
      />,
    );
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(html).toMatch(
      /^<article class="hike-card hike-card--full hike-card--upcoming" aria-labelledby="/,
    );
    expect(html).toContain(
      `<h2 class="hike-card__title" id="${id}">Mailbox Peak</h2>`,
    );
    expect(html).toContain(
      '<p class="hike-card__leaf" aria-hidden="true"><span class="hike-card__weekday">Sat</span><span class="hike-card__day">5</span><span class="hike-card__month">Dec</span></p>',
    );
    expect(html).toContain(
      '<time datetime="2026-12-05T11:00">Sat, 5 Dec 2026 · 11:00</time> <span class="hike-card__zone">America/Los_Angeles</span>',
    );
    expect(html).toContain('class="status-pill status-pill--planned"');
    const hrefs = [
      ...html.matchAll(/<a class="hike-card__link" href="([^"]+)"/g),
    ].map(([, href]) => href);
    expect(hrefs).toEqual([
      LINKS.thread,
      LINKS.event,
      LINKS.calendar,
      LINKS.map.replace("&", "&amp;"),
    ]);
    expect(await spokenText(html)).toBe(
      "Mailbox Peak Sat, 5 Dec 2026 · 11:00 America/Los_Angeles Planned Old trail up, new trail down. Proposed by Ana Hike thread Hike event Calendar Map",
    );
  });

  it("says a past hike is past, and leaves out the links it does not have", async () => {
    const html = render(
      <HikeCard
        location="Little Si"
        start={{ ...START, date: "2026-10-31" }}
        when="past"
        links={{ thread: LINKS.thread, event: null }}
        headingLevel={3}
      />,
    );
    expect(html).toMatch(
      /^<article class="hike-card hike-card--full hike-card--past"/,
    );
    expect(html).toContain('<h3 class="hike-card__title"');
    expect(html).toContain('<p class="hike-card__state">Past hike</p>');
    expect(html).not.toContain("status-pill");
    expect(html.match(/hike-card__link"/g)).toHaveLength(1);
    expect(await spokenText(html)).toBe(
      "Little Si Sat, 31 Oct 2026 · 11:00 America/Los_Angeles Past hike Hike thread",
    );
  });

  it("has no links row without links", () => {
    const html = render(
      <HikeCard location="Little Si" start={START} when="past" />,
    );
    expect(html).not.toContain("hike-card__links");
  });

  it("leaves the details, proposer and picture out of the compact card", () => {
    const html = render(
      <HikeCard
        size="compact"
        location="Mailbox Peak"
        details="Old trail up."
        proposer="Ana"
        start={START}
        when="upcoming"
        links={{ thread: LINKS.thread }}
        picture={<img src="/map.png" alt="Map of Mailbox Peak" />}
      />,
    );
    expect(html).toMatch(
      /^<article class="hike-card hike-card--compact hike-card--upcoming"/,
    );
    expect(html).not.toContain("Old trail up.");
    expect(html).not.toContain("Proposed by");
    expect(html).not.toContain("<img");
    expect(html).toContain("Hike thread");
  });

  it("has room for a map picture in the full card", () => {
    const html = render(
      <HikeCard
        location="Mailbox Peak"
        start={START}
        when="upcoming"
        picture={<img src="/map.png" alt="Map of Mailbox Peak" />}
      />,
    );
    expect(html).toContain(
      '<div class="hike-card__picture"><img src="/map.png" alt="Map of Mailbox Peak"/></div>',
    );
  });

  it("renders text from members as text", async () => {
    const html = render(
      <HikeCard
        location="<script>alert(1)</script> **Ridge**"
        details='<a href="javascript:alert(2)">map</a> _see_'
        proposer="<i>Eve</i>"
        start={START}
        when="upcoming"
      />,
    );
    const page = await outline(html);
    expect(page.scripts).toBe(0);
    expect(page.elements).not.toContain("a");
    expect(page.elements).not.toContain("i");
    expect(html).toContain("&lt;script>alert(1)&lt;/script> **Ridge**");
    expect(html).toContain(
      "&lt;a href=&quot;javascript:alert(2)&quot;>map&lt;/a> _see_",
    );
  });
});
