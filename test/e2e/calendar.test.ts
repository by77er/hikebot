import { expect, it } from "vitest";
import { eventually, messageText, type Member } from "./harness/helpers";
import { subcommand } from "./harness/interactions";
import { expectEphemeral, RoundPlayer } from "./harness/rounds";
import { PageClient } from "./harness/web";
import { PUBLIC_URL, useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

/** The calendar address `/hike log` shows `member`. */
async function calendarAddress(member: Member): Promise<URL> {
  await member.run("hike", [subcommand("log")]);
  expectEphemeral(
    member,
    "Calendar apps can subscribe to this address to show every hike",
  );
  const match = /Calendar: (\S+)/.exec(messageText(member.lastReply()));
  if (!match?.[1]) throw new Error("the log shows no calendar address");
  return new URL(match[1]);
}

/** The VEVENTs of a feed, each as its unfolded properties by name. */
function events(feed: string): Record<string, string>[] {
  const lines = feed.replaceAll("\r\n ", "").split("\r\n");
  const found: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT" && current) {
      found.push(current);
      current = null;
    } else if (current) {
      const at = line.indexOf(":");
      current[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  return found;
}

it("serves the hikes at the calendar address /hike log shows, to anyone who has it", async () => {
  const g = play.guild(1);
  const [, member] = g.members as [Member, Member];
  const panel = await play.setUpPanel(g);
  await play.playHike(g, panel, {
    location: "Ridge",
    dates: ["2030-06-08", "2030-06-15 09:30"],
    date: "Sat, 15 Jun 2030 · 09:30",
  });

  // The thread and event ids are stored by the close's follow-up.
  await eventually(async () => {
    await member.run("hike", [subcommand("log")]);
    expect(messageText(member.lastReply())).toMatch(
      /Thread: <#\d+> · \[Event\]/,
    );
  });
  const address = await calendarAddress(member);
  expect(address.origin).toBe(PUBLIC_URL);
  expect(address.pathname).toMatch(
    new RegExp(`^/calendar/${g.guildId}/[A-Za-z0-9_-]{43}\\.ics$`),
  );

  const browser = new PageClient(e2e.url);
  const first = await browser.get(address.pathname);
  expect(first.status).toBe(200);
  expect(first.headers.get("content-type")).toBe(
    "text/calendar; charset=utf-8",
  );
  expect(first.headers.get("cache-control")).toBe("public, max-age=300");
  const [thread] = e2e.discord.threads(g.channels.forum);
  if (!thread) throw new Error("the hike thread was not created");
  const [ridge] = events(first.body);
  expect(events(first.body)).toHaveLength(1);
  // 09:30 in Los Angeles in June is 16:30 UTC.
  expect(ridge).toMatchObject({
    SUMMARY: "Hike: Ridge",
    LOCATION: "Ridge",
    DTSTART: "20300615T163000Z",
    DTEND: "20300615T203000Z",
    URL: `https://discord.com/channels/${g.guildId}/${thread.id}`,
  });
  const etag = first.headers.get("etag") ?? "";
  const cached = await browser.request(address.pathname, {
    headers: { "If-None-Match": etag },
  });
  expect(cached.status).toBe(304);
  expect(cached.body).toBe("");

  await play.playHike(g, panel, {
    location: "Lake",
    dates: ["2030-03-02", "2030-03-09"],
    date: "Sat, 2 Mar 2030 · 11:00",
  });
  const second = await browser.request(address.pathname, {
    headers: { "If-None-Match": etag },
  });
  expect(second.status).toBe(200);
  expect(second.headers.get("etag")).not.toBe(etag);
  const both = events(second.body);
  expect(both.map((event) => [event.SUMMARY, event.DTSTART])).toEqual([
    ["Hike: Ridge", "20300615T163000Z"],
    // 11:00 in Los Angeles in March, before the clocks change, is 19:00 UTC.
    ["Hike: Lake", "20300302T190000Z"],
  ]);
  expect(both[0]?.UID).toBe(ridge?.UID);
  expect(both[1]?.UID).not.toBe(ridge?.UID);

  const signature = address.pathname.split("/")[3] ?? "";
  const changed = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  const forged = await browser.get(
    address.pathname.replace(signature, changed),
  );
  expect(forged.status).toBe(404);
  expect(forged.body).not.toContain("VCALENDAR");
});

it("serves a guild without hikes a calendar with no events", async () => {
  const g = play.guild(2);
  const [member] = g.members as [Member];
  const address = await calendarAddress(member);
  const feed = await new PageClient(e2e.url).get(address.pathname);
  expect(feed.status).toBe(200);
  expect(feed.body).toContain("BEGIN:VCALENDAR\r\n");
  expect(events(feed.body)).toEqual([]);
});
