import { describe, expect, it } from "vitest";
import type { FakeMessage } from "./harness/fake-discord";
import { DEFAULT_WEATHER } from "./harness/fake-open-meteo";
import { eventually, Member, messageText } from "./harness/helpers";
import {
  ROUND_IDS,
  RoundPlayer,
  expectEphemeral,
  idStarting,
  type TestGuild,
} from "./harness/rounds";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

/** Paradise, on Mount Rainier. */
const PARADISE = "46.78591, -121.73532";

/** The forecast arrives after the close flow and the job's first run. */
const FORECAST_TIMEOUT = { timeout: 15_000 };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** The day `n` days after today in Los Angeles, the default zone. */
function daysAhead(n: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(Date.now());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** How the poll shows `day` at `time`: `Sat, 5 Dec 2026 · 13:00`. */
function shownAs(day: string, time: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()] ?? ""}, ${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ""} ${String(date.getUTCFullYear())} · ${time}`;
}

/** The starter message of the guild's only hike thread. */
function threadMessage(g: TestGuild): FakeMessage {
  const [thread] = e2e.discord.threads(g.channels.forum);
  const [first] = e2e.discord.channelMessages(thread?.id ?? "");
  if (!thread || !first) throw new Error("the hike thread was not created");
  return first;
}

function eventDescription(g: TestGuild): string {
  return e2e.discord.scheduledEvents(g.guildId)[0]?.description ?? "";
}

/**
 * Plays a hike at `location`, proposed by a member with `map` as its map
 * pin (none when empty), on the day three days from now at 13:00, through
 * both votes. Returns the panel and the day.
 */
async function planHike(
  g: TestGuild,
  location: string,
  map: string,
): Promise<{ panel: FakeMessage; day: string }> {
  const [ana, ben] = g.members as [Member, Member];
  const panel = await play.setUpPanel(g);
  const poll = await play.startLocationVote(g, panel, "Snow Lake");
  const form = await ana.click(
    poll,
    idStarting(play.shown(poll), "hb:location:propose:"),
  );
  await ana.submitModal(
    form,
    { "hb:location:name": location, "hb:location:map": map },
    poll,
  );
  expectEphemeral(ana, `Added **${location}** to the location vote.`);
  await play.vote(ben, poll, [location]);
  await play.closeVote(g.owner, panel, "location vote");
  const day = daysAhead(3);
  const when = await play.startDateVote(
    g,
    panel,
    [`${day} 13:00`, `${daysAhead(4)} 13:00`].join("\n"),
  );
  await play.vote(ben, when, [shownAs(day, "13:00")]);
  await play.closeVote(g.owner, panel, "date vote");
  return { panel, day };
}

/** Sets the map pin of the planned hike from the panel. */
async function setPin(g: TestGuild, panel: FakeMessage, point: string) {
  const form = await g.owner.click(
    panel,
    idStarting(play.shown(panel), "hb:pin:set:"),
  );
  await g.owner.submitModal(form, { "hb:pin:point": point }, panel);
  await eventually(() => {
    expect(messageText(play.shown(panel))).toContain("The map pin of **");
  });
}

describe("the hike's weather", () => {
  it("shows the hourly forecast in the thread and the event once the date vote closes, and the new forecast after a refresh", async () => {
    const g = play.guild(1);
    e2e.weather.setWeather(DEFAULT_WEATHER);
    const { panel, day } = await planHike(g, "Paradise", PARADISE);

    // 10 °C, feeling 8 °C, 0.2 mm, wind 10 km/h with gusts of 20, in the
    // server's default imperial units.
    await eventually(() => {
      const thread = messageText(threadMessage(g));
      expect(thread).toContain("### Weather");
      expect(thread).toMatch(/\n13:00 +50\/46 +20% +0\.01 +6\/12 +Overcast\n/);
      expect(thread).toContain("Sunrise 07:30 · Sunset 16:30");
      expect(thread).toContain(
        "[Weather data by Open-Meteo.com](https://open-meteo.com/)",
      );
    }, FORECAST_TIMEOUT);
    await eventually(() => {
      expect(eventDescription(g)).toContain(
        "Weather: 50°F, up to 20% chance of rain, gusts up to 12 mph\n13:00 Overcast, 50°F, rain 20%, gusts 12 mph",
      );
    });
    expect(eventDescription(g)).toContain(
      "Weather data by Open-Meteo.com: https://open-meteo.com/",
    );
    const [asked] = e2e.weather.requests.filter(
      (r) => r.query.start_date === day,
    );
    expect(asked?.query).toMatchObject({
      latitude: "46.7859",
      longitude: "-121.7353",
      timezone: "America/Los_Angeles",
      end_date: day,
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      precipitation_unit: "inch",
    });
    expect(asked?.userAgent).toContain("hikebot");

    // Rain moves in; setting the same pin again runs the refresh at once.
    e2e.weather.setWeather({ code: 61, temperature: 15, feelsLike: 13 });
    await setPin(g, panel, PARADISE);
    await eventually(() => {
      expect(messageText(threadMessage(g))).toMatch(
        /\n13:00 +59\/55 +20% +0\.01 +6\/12 +Light rain\n/,
      );
      expect(eventDescription(g)).toContain(
        "Weather: 59°F, up to 20% chance of rain, gusts up to 12 mph\n13:00 Light rain, 59°F",
      );
    }, FORECAST_TIMEOUT);
  });

  it("says a hike without a map pin has no forecast, then shows one after Set map pin", async () => {
    const g = play.guild(2);
    e2e.weather.setWeather(DEFAULT_WEATHER);
    const { panel } = await planHike(g, "Somewhere Nice", "");
    const noPin =
      "No forecast: this hike has no map pin. An admin can set one from /hike admin.";
    await eventually(() => {
      expect(messageText(threadMessage(g))).toContain(`### Weather\n${noPin}`);
      expect(eventDescription(g)).toContain(`Weather: ${noPin}`);
    });

    await setPin(g, panel, PARADISE);
    await eventually(() => {
      expect(messageText(threadMessage(g))).toMatch(/\n13:00 +50\/46 /);
      expect(eventDescription(g)).toContain("Weather: 50°F");
    }, FORECAST_TIMEOUT);
  });

  it("asks in metric and shows °C, km/h and mm once an admin picks metric", async () => {
    const g = play.guild(3);
    e2e.weather.setWeather(DEFAULT_WEATHER);
    const { panel } = await planHike(g, "Paradise", PARADISE);
    await eventually(() => {
      expect(eventDescription(g)).toContain("Weather: 50°F");
    }, FORECAST_TIMEOUT);

    await g.owner.click(panel, ROUND_IDS.settings);
    await g.owner.select(panel, "hb:admin:units", ["metric"]);
    expect(messageText(play.shown(panel))).toContain("Units set to metric.");
    await eventually(() => {
      expect(messageText(threadMessage(g))).toMatch(
        /\n13:00 +10\/8 +20% +0\.2 +10\/20 +Overcast\n/,
      );
      expect(eventDescription(g)).toContain(
        "Weather: 10°C, up to 20% chance of rain, gusts up to 20 km/h",
      );
    }, FORECAST_TIMEOUT);
    expect(e2e.weather.requests.at(-1)?.query).toMatchObject({
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
      precipitation_unit: "mm",
    });
  });

  it("edits an archived thread and archives it again, and leaves a deleted event alone", async () => {
    const g = play.guild(4);
    e2e.weather.setWeather(DEFAULT_WEATHER);
    const { panel } = await planHike(g, "Paradise", PARADISE);
    await eventually(() => {
      expect(eventDescription(g)).toContain("Weather: 50°F");
    }, FORECAST_TIMEOUT);
    const [thread] = e2e.discord.threads(g.channels.forum);
    const [event] = e2e.discord.scheduledEvents(g.guildId);
    if (!thread || !event) throw new Error("no thread or event");
    e2e.discord.archiveThread(thread.id);
    e2e.discord.deleteScheduledEvent(g.guildId, event.id);

    e2e.weather.setWeather({ code: 71, temperature: -2, feelsLike: -6 });
    await setPin(g, panel, PARADISE);
    await eventually(() => {
      expect(messageText(threadMessage(g))).toMatch(
        /\n13:00 +28\/21 +20% +0\.01 +6\/12 +Light snow\n/,
      );
    }, FORECAST_TIMEOUT);
    await eventually(() => {
      expect(e2e.discord.channel(thread.id)?.thread_metadata?.archived).toBe(
        true,
      );
    });
  });
});
