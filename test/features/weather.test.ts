import {
  createExecutionContext,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  ComponentType,
  InteractionResponseType,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ADMIN_PANEL_IDS } from "../../src/features/admin-panel";
import { MAP_PIN_IDS } from "../../src/features/map-pin";
import { POLL_IDS } from "../../src/features/poll-ui";
import { WEATHER_REFRESH_MS } from "../../src/features/weather";
import {
  WEATHER_JOB,
  forecastOpensAt,
  weatherRecords,
  weatherTexts,
  withinForecast,
} from "../../src/features/weather-state";
import { GuildConfig } from "../../src/guild/config";
import { schedule, scheduledJobs } from "../../src/guild/schedule";
import { hikeStart } from "../../src/polls/dates";
import {
  MAX_DETAILS_LENGTH,
  MAX_LABEL_LENGTH,
  PollStore,
  type OptionPlace,
  type RoundView,
} from "../../src/polls/store";
import type {
  ForecastHour,
  StoredForecast,
  Units,
} from "../../src/weather/forecast";
import {
  MAX_EVENT_DESCRIPTION,
  hikeEventDescription,
} from "../../src/features/hike-event";
import { renderThreadMessage } from "../../src/features/hike-thread";
import { MAX_PLACE_NAME } from "../../src/geo/nominatim";
import {
  FORECAST_NO_PIN,
  FORECAST_PENDING,
  FORECAST_TOO_FAR,
} from "../../src/weather/format";
import {
  callWorker,
  componentInteraction,
  createSigner,
  modalInteraction,
  signedRequest,
  type Signer,
} from "../helpers";
import paradise from "../weather/fixtures/paradise-snow-imperial.json";

const OWNER = "400000000000000001";
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const THREAD = "900000000000000001";
const EVENT = "950000000000000001";
const LA = "America/Los_Angeles";
const HOUR = 60 * 60 * 1000;
const FORECAST_URL = "https://open-meteo.test/v1/forecast";

/** Paradise, Mount Rainier, where the recorded answer is for. */
const PARADISE = { lat: 46.78591, lon: -121.73532 };
const PINNED: OptionPlace = {
  status: "given",
  point: PARADISE,
  name: null,
  attempts: 0,
};
const UNPINNED: OptionPlace = {
  status: "not_found",
  point: null,
  name: null,
  attempts: 1,
};

/** The hike: Sat 21 Nov 2026, 13:00 in Los Angeles, 21:00 UTC. */
const DATE = "2026-11-21 13:00";
const START = hikeStart(DATE, LA);
const END = START + 4 * HOUR;
/** Two days before, at 12:00 UTC. */
const CLOSED_AT = Date.UTC(2026, 10, 19, 12);

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Sets the clock the Worker, the object and its store read. */
function setNow(at: number): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

function inObject<T>(
  guildId: string,
  run: (storage: DurableObjectStorage) => T | Promise<T>,
): Promise<T> {
  return runInDurableObject(stub(guildId), (_i, state) => run(state.storage));
}

interface Node {
  type: number;
  content?: string;
  components?: Node[];
  component?: Node;
  accessory?: Node;
}

function flatten(components: readonly Node[]): Node[] {
  return components.flatMap((c) => [
    c,
    ...flatten(c.components ?? []),
    ...flatten(c.component ? [c.component] : []),
    ...flatten(c.accessory ? [c.accessory] : []),
  ]);
}

function text(components: readonly unknown[] = []): string {
  return flatten(components as Node[])
    .map((c) => c.content ?? "")
    .filter((c) => c !== "")
    .join("\n");
}

interface Sent {
  route: string;
  body: {
    description?: string | null;
    archived?: boolean;
    components?: APIMessageTopLevelComponent[];
  };
}

/** The recorded answer, moved to `day` (`YYYY-MM-DD`). */
function answerOn(
  day: string,
  change: (answer: typeof paradise) => void = () => undefined,
) {
  const answer = structuredClone(paradise);
  answer.hourly.time = answer.hourly.time.map((t) =>
    t.replace("2026-11-21", day),
  );
  answer.daily.time = [day];
  answer.daily.sunrise = answer.daily.sunrise.map((t) =>
    t.replace("2026-11-21", day),
  );
  answer.daily.sunset = answer.daily.sunset.map((t) =>
    t.replace("2026-11-21", day),
  );
  change(answer);
  return answer;
}

/** How each fake answers; tests change them between runs. */
interface World {
  sent: Sent[];
  asked: URL[];
  forecast: () => Response;
  thread: () => Response | null;
  event: () => Response | null;
  /** Whether the thread is archived, as the bot last set it. */
  archived: boolean;
  /** Whether archiving the thread is refused, as without Manage Threads. */
  archiveRefused: boolean;
}

/**
 * Stubs Discord (the guild owner, a thread `THREAD`, an event `EVENT`, any
 * message) and Open-Meteo, which answers `world.forecast()`; the thread's
 * first message and the event are edited as `world.thread()` and
 * `world.event()` answer, or with success when they answer null. Returns
 * the world, with what the bot sent to Discord (GETs left out) and asked
 * Open-Meteo.
 */
function stubWorld(guildId: string): World {
  const world: World = {
    sent: [],
    asked: [],
    forecast: () => Response.json(answerOn("2026-11-21")),
    thread: () => null,
    event: () => null,
    archived: false,
    archiveRefused: false,
  };
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.href.startsWith(FORECAST_URL)) {
      world.asked.push(url);
      return Promise.resolve(world.forecast());
    }
    const path = url.pathname.replace("/api/v10", "");
    if (request.method !== "GET") {
      world.sent.push({
        route: `${request.method} ${path}`,
        body: JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as Sent["body"],
      });
    }
    if (path === `/guilds/${guildId}`) {
      return Promise.resolve(Response.json({ id: guildId, owner_id: OWNER }));
    }
    if (path.endsWith("/threads")) {
      return Promise.resolve(
        Response.json({ id: THREAD, parent_id: FORUM }, { status: 201 }),
      );
    }
    if (path === `/guilds/${guildId}/scheduled-events`) {
      return Promise.resolve(Response.json({ id: EVENT, guild_id: guildId }));
    }
    if (path === `/channels/${THREAD}/messages/${THREAD}`) {
      // "Tried to perform an operation on an archived thread, such as
      // editing a message": https://docs.discord.com/developers/topics/opcodes-and-status-codes
      const archived = Response.json(
        { message: "Thread is archived", code: 50083 },
        { status: 400 },
      );
      return Promise.resolve(
        world.thread() ??
          (world.archived ? archived : Response.json({ id: THREAD })),
      );
    }
    if (path === `/channels/${THREAD}` && request.method === "PATCH") {
      const { archived } = JSON.parse(
        typeof init?.body === "string" ? init.body : "{}",
      ) as Sent["body"];
      if (archived === true && world.archiveRefused) {
        return Promise.resolve(
          Response.json(
            { message: "Missing Permissions", code: 50013 },
            { status: 403 },
          ),
        );
      }
      if (archived !== undefined) world.archived = archived;
      return Promise.resolve(Response.json({ id: THREAD }));
    }
    if (path === `/guilds/${guildId}/scheduled-events/${EVENT}`) {
      return Promise.resolve(world.event() ?? Response.json({ id: EVENT }));
    }
    return Promise.resolve(Response.json({ id: "1" }));
  });
  return world;
}

const routes = (world: World) => world.sent.map((r) => r.route);
const THREAD_EDIT = `PATCH /channels/${THREAD}/messages/${THREAD}`;
const eventEdit = (guild: string) =>
  `PATCH /guilds/${guild}/scheduled-events/${EVENT}`;

function click(
  customId: string,
  guildId: string,
): APIMessageComponentInteraction {
  const interaction = componentInteraction(customId, guildId);
  Object.assign(interaction, {
    member: { user: { id: OWNER }, roles: [] },
    message: { id: "800000000000000009", components: [] },
  });
  return interaction;
}

/** Sends the interaction through the Worker and waits for its follow-up. */
async function send(interaction: unknown) {
  const ctx = createExecutionContext();
  const response = await callWorker(
    signer,
    await signedRequest(signer, interaction),
    ctx,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{
    type: InteractionResponseType;
    data?: { components: APIMessageTopLevelComponent[] };
  }>();
  await waitOnExecutionContext(ctx);
  return body;
}

/**
 * Plays a round in `guild` up to an open date vote that `date` wins, with
 * the location pinned as `place`, then closes it through the Worker,
 * follow-up and all. Returns the round's id.
 */
async function planHike(
  guild: string,
  {
    date = DATE,
    place = PINNED,
    units,
  }: {
    date?: string;
    place?: OptionPlace;
    units?: Units;
  } = {},
): Promise<number> {
  const { roundId, pollId } = await inObject(guild, (storage) => {
    const config = new GuildConfig(storage);
    config.set("voteChannelId", TEXT);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
    if (units) config.setUnits(units);
    const store = new PollStore(storage);
    const started = store.startRound(OWNER, [
      {
        label: "Paradise",
        details: "Meet at the visitor centre.",
        proposedBy: OWNER,
        place,
      },
    ]);
    const where = started.locationPoll?.id ?? 0;
    store.setVotes(where, "u1", [started.locationPoll?.options[0]?.id ?? 0]);
    store.closePoll(where, OWNER);
    const poll = store.startDatePoll(started.id, OWNER, [
      date,
      "2030-01-05 11:00",
    ]);
    store.setPollMessage(poll.id, TEXT, "700000000000000002");
    const winner = poll.options.find((o) => o.dateValue === date);
    store.setVotes(poll.id, "u1", [winner?.id ?? 0]);
    return { roundId: started.id, pollId: poll.id };
  });
  const reply = await send(click(POLL_IDS.closeConfirm(pollId), guild));
  expect(reply.type).toBe(InteractionResponseType.DeferredMessageUpdate);
  return roundId;
}

const jobs = (guild: string) =>
  inObject(guild, (storage) => scheduledJobs(storage));

const roundOf = (guild: string, roundId: number) =>
  inObject(guild, (storage) => new PollStore(storage).getRound(roundId));

/** Runs the alarm once and checks that the weather job was due. */
async function runWeather(guild: string): Promise<void> {
  expect((await jobs(guild)).get(WEATHER_JOB)).toBeLessThanOrEqual(Date.now());
  expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
}

/** The text of the last thread edit and the last event description. */
function shown(world: World, guild: string) {
  const thread = world.sent.filter((r) => r.route === THREAD_EDIT).at(-1);
  const event = world.sent.filter((r) => r.route === eventEdit(guild)).at(-1);
  return {
    thread: text(thread?.body.components),
    event: event?.body.description ?? "",
  };
}

describe("the weather:refresh job", () => {
  it("runs when the date vote closes, fetches the hike's day and shows it in the thread and the event", async () => {
    const guild = "200000000000000701";
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    const roundId = await planHike(guild);
    // The thread and the event were made before the first forecast.
    const created = world.sent.find(
      (r) => r.route === `POST /channels/${FORUM}/threads`,
    );
    expect(JSON.stringify(created?.body)).toContain(FORECAST_PENDING);
    expect(world.asked).toEqual([]);

    await runWeather(guild);
    expect(world.asked).toHaveLength(1);
    expect(
      Object.fromEntries(world.asked[0]?.searchParams ?? []),
    ).toMatchObject({
      latitude: "46.7859",
      longitude: "-121.7353",
      timezone: LA,
      start_date: "2026-11-21",
      end_date: "2026-11-21",
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      precipitation_unit: "inch",
    });
    const { thread, event } = shown(world, guild);
    expect(thread).toContain("### Weather");
    expect(thread).toContain("13:00   32/23  14%  0.00    7/6  Overcast");
    expect(thread).toContain("Snowfall: 0.06 in over these hours");
    expect(thread).toContain(
      "[Weather data by Open-Meteo.com](https://open-meteo.com/)",
    );
    expect(thread).toContain("## Paradise");
    expect(event).toContain(
      "Weather: 26 to 32°F, up to 31% chance of rain, gusts up to 7 mph",
    );
    expect(event).toContain(
      "Updated Thu, 19 Nov 2026 · 04:00 (America/Los_Angeles)",
    );
    expect(event).toContain("Meet at the visitor centre.");

    const round = await roundOf(guild, roundId);
    expect(round?.forecast?.fetchedAt).toBe(CLOSED_AT);
    expect(round?.forecast?.updatedAt).toBe(CLOSED_AT);
    expect(round?.forecast?.forecast.point).toEqual(PARADISE);
    expect((await jobs(guild)).get(WEATHER_JOB)).toBe(
      CLOSED_AT + WEATHER_REFRESH_MS,
    );
  });

  it("edits each surface once for two runs with the same answer, and again when the forecast changes", async () => {
    const guild = "200000000000000702";
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    const roundId = await planHike(guild);
    // The close flow edited the thread once, to link the event.
    const edits = () => [
      routes(world).filter((r) => r === THREAD_EDIT).length - 1,
      routes(world).filter((r) => r === eventEdit(guild)).length,
    ];
    expect(edits()).toEqual([0, 0]);
    await runWeather(guild);
    expect(edits()).toEqual([1, 1]);

    setNow(CLOSED_AT + HOUR);
    await runWeather(guild);
    expect(world.asked).toHaveLength(2);
    expect(edits()).toEqual([1, 1]);
    const same = await roundOf(guild, roundId);
    expect(same?.forecast?.fetchedAt).toBe(CLOSED_AT + HOUR);
    expect(same?.forecast?.updatedAt).toBe(CLOSED_AT);

    world.forecast = () =>
      Response.json(
        answerOn("2026-11-21", (answer) => {
          answer.hourly.temperature_2m = answer.hourly.temperature_2m.map(
            (t) => t + 5,
          );
        }),
      );
    setNow(CLOSED_AT + 2 * HOUR);
    await runWeather(guild);
    expect(edits()).toEqual([2, 2]);
    expect(shown(world, guild).event).toContain("31 to 37°F");
    expect((await roundOf(guild, roundId))?.forecast?.updatedAt).toBe(
      CLOSED_AT + 2 * HOUR,
    );
  });

  it("keeps the last forecast when a fetch fails and tries again an hour later", async () => {
    const guild = "200000000000000703";
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    const roundId = await planHike(guild);
    await runWeather(guild);
    const before = await roundOf(guild, roundId);
    const sent = world.sent.length;

    world.forecast = () =>
      Response.json({ error: true, reason: "busy" }, { status: 503 });
    setNow(CLOSED_AT + HOUR);
    await runWeather(guild);
    expect(world.asked).toHaveLength(2);
    expect(world.sent).toHaveLength(sent);
    expect((await roundOf(guild, roundId))?.forecast).toEqual(before?.forecast);
    expect((await jobs(guild)).get(WEATHER_JOB)).toBe(CLOSED_AT + 2 * HOUR);

    world.forecast = () =>
      Response.json(
        answerOn("2026-11-21", (answer) => {
          answer.hourly.wind_gusts_10m = answer.hourly.wind_gusts_10m.map(
            (g) => g + 20,
          );
        }),
      );
    setNow(CLOSED_AT + 2 * HOUR);
    await runWeather(guild);
    expect(shown(world, guild).event).toContain("gusts up to 27 mph");
  });

  it("runs every hour until the hike is over, then stops and forgets the round", async () => {
    const guild = "200000000000000704";
    setNow(END - 90 * 60 * 1000);
    const world = stubWorld(guild);
    await planHike(guild);
    await runWeather(guild);
    expect((await jobs(guild)).get(WEATHER_JOB)).toBe(END - 30 * 60 * 1000);

    // Half an hour before the end, the next hour would be after it.
    setNow(END - 30 * 60 * 1000);
    await runWeather(guild);
    expect(world.asked).toHaveLength(2);
    expect((await jobs(guild)).has(WEATHER_JOB)).toBe(false);

    // Run once more after the end: it forgets the round and fetches nothing.
    setNow(END + 1);
    await inObject(guild, (storage) => schedule(storage, WEATHER_JOB, END + 1));
    await runWeather(guild);
    expect(world.asked).toHaveLength(2);
    expect((await jobs(guild)).has(WEATHER_JOB)).toBe(false);
    expect(
      await inObject(guild, (storage) => weatherRecords(storage).size),
    ).toBe(0);
  });

  it("waits for Open-Meteo's 16 days to reach a hike further ahead, and says so meanwhile", async () => {
    const guild = "200000000000000705";
    const date = "2026-12-20 13:00";
    const start = hikeStart(date, LA);
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    world.forecast = () => Response.json(answerOn("2026-12-20"));
    await planHike(guild, { date });
    await runWeather(guild);
    expect(world.asked).toEqual([]);
    const created = world.sent.find(
      (r) => r.route === `POST /channels/${FORUM}/threads`,
    );
    expect(JSON.stringify(created?.body)).toContain(FORECAST_TOO_FAR);
    const event = world.sent.find(
      (r) => r.route === `POST /guilds/${guild}/scheduled-events`,
    );
    expect(JSON.stringify(event?.body)).toContain(
      `Weather: ${FORECAST_TOO_FAR}`,
    );
    // Midnight in Los Angeles on Sat 5 Dec, 15 days before the hike's day.
    const opens = hikeStart("2026-12-05 00:00", LA);
    expect((await jobs(guild)).get(WEATHER_JOB)).toBe(opens);

    setNow(opens);
    await runWeather(guild);
    expect(world.asked).toHaveLength(1);
    expect(world.asked[0]?.searchParams.get("start_date")).toBe("2026-12-20");
    expect(shown(world, guild).thread).toContain("13:00   32/23  14%");
    expect((await jobs(guild)).get(WEATHER_JOB)).toBe(opens + HOUR);
    expect(start).toBeGreaterThan(opens);
  });

  it("says a hike without a map pin has no forecast, then shows one on the next run after Set map pin", async () => {
    const guild = "200000000000000706";
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    const roundId = await planHike(guild, { place: UNPINNED });
    const created = world.sent.find(
      (r) => r.route === `POST /channels/${FORUM}/threads`,
    );
    expect(JSON.stringify(created?.body)).toContain(FORECAST_NO_PIN);
    const sent = world.sent.length;
    await runWeather(guild);
    expect(world.asked).toEqual([]);
    expect(world.sent).toHaveLength(sent);
    expect((await jobs(guild)).has(WEATHER_JOB)).toBe(false);

    const pin = modalInteraction(MAP_PIN_IDS.set(roundId), guild);
    Object.assign(pin, {
      member: { user: { id: OWNER }, roles: [] },
      message: { id: "800000000000000009", components: [] },
    });
    Object.assign(pin.data, {
      components: [
        {
          type: ComponentType.Label,
          component: {
            type: ComponentType.TextInput,
            custom_id: MAP_PIN_IDS.point,
            value: "46.78591, -121.73532",
          },
        },
      ],
    });
    await send(pin);
    // The pin hooks show the pin with the forecast on its way...
    expect(shown(world, guild).thread).toContain(FORECAST_PENDING);
    expect(shown(world, guild).event).toContain(`Weather: ${FORECAST_PENDING}`);
    // ...and the job's next run fetches it.
    await runWeather(guild);
    expect(world.asked).toHaveLength(1);
    expect(shown(world, guild).thread).toContain("13:00   32/23  14%");
    expect(shown(world, guild).event).toContain("Weather: 26 to 32°F");
  });

  it("asks in metric and shows °C, km/h and mm once an admin picks metric", async () => {
    const guild = "200000000000000707";
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    await planHike(guild);
    await runWeather(guild);

    const metric = (
      await import("../weather/fixtures/hoh-storm-metric-edited.json")
    ).default;
    world.forecast = () => {
      const answer = structuredClone(metric);
      answer.hourly.time = answer.hourly.time.map((t) =>
        t.replace("2026-11-24", "2026-11-21"),
      );
      answer.daily.sunrise = ["2026-11-21T07:34"];
      answer.daily.sunset = ["2026-11-21T16:29"];
      return Response.json(answer);
    };
    const pick = click(ADMIN_PANEL_IDS.units, guild);
    Object.assign(pick.data, {
      component_type: ComponentType.StringSelect,
      values: ["metric"],
    });
    const reply = await send(pick);
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(reply.data?.components)).toContain("Units set to metric.");
    expect((await jobs(guild)).get(WEATHER_JOB)).toBeLessThanOrEqual(
      Date.now(),
    );

    await runWeather(guild);
    expect(world.asked.at(-1)?.searchParams.get("temperature_unit")).toBe(
      "celsius",
    );
    expect(world.asked.at(-1)?.searchParams.get("wind_speed_unit")).toBe("kmh");
    expect(world.asked.at(-1)?.searchParams.get("precipitation_unit")).toBe(
      "mm",
    );
    expect(shown(world, guild).thread).toContain("°C");
    expect(shown(world, guild).event).toContain(
      "Weather: 7 to 11°C, up to 95% chance of rain, gusts up to 80 km/h",
    );
  });
});

describe("surfaces that went away", () => {
  it("stops editing a deleted thread and keeps editing the event", async () => {
    const guild = "200000000000000711";
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    await planHike(guild);
    world.thread = () =>
      Response.json(
        { message: "Unknown Channel", code: 10003 },
        { status: 404 },
      );
    await runWeather(guild);
    // One edit linked the event when the vote closed; the second got 404.
    expect(routes(world).filter((r) => r === THREAD_EDIT)).toHaveLength(2);
    expect(routes(world).filter((r) => r === eventEdit(guild))).toHaveLength(1);

    world.forecast = () =>
      Response.json(
        answerOn("2026-11-21", (answer) => {
          answer.hourly.precipitation_probability =
            answer.hourly.precipitation_probability.map(() => 80);
        }),
      );
    setNow(CLOSED_AT + HOUR);
    await runWeather(guild);
    expect(routes(world).filter((r) => r === THREAD_EDIT)).toHaveLength(2);
    expect(routes(world).filter((r) => r === eventEdit(guild))).toHaveLength(2);
    expect(shown(world, guild).event).toContain("up to 80% chance of rain");
  });

  it("stops editing a deleted event and keeps editing the thread", async () => {
    const guild = "200000000000000712";
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    await planHike(guild);
    world.event = () =>
      Response.json(
        { message: "Unknown Guild Scheduled Event", code: 10070 },
        { status: 404 },
      );
    await runWeather(guild);
    world.forecast = () =>
      Response.json(
        answerOn("2026-11-21", (answer) => {
          answer.hourly.precipitation_probability =
            answer.hourly.precipitation_probability.map(() => 80);
        }),
      );
    setNow(CLOSED_AT + HOUR);
    await runWeather(guild);
    expect(routes(world).filter((r) => r === eventEdit(guild))).toHaveLength(1);
    // The edit that linked the event, then one per run.
    expect(routes(world).filter((r) => r === THREAD_EDIT)).toHaveLength(3);
    expect(shown(world, guild).thread).toContain(" 80% ");
  });

  it("tries a surface again on the next run after another failure", async () => {
    const guild = "200000000000000713";
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    await planHike(guild);
    world.event = () =>
      Response.json(
        { message: "Missing Permissions", code: 50013 },
        { status: 403 },
      );
    await runWeather(guild);
    world.event = () => null;
    setNow(CLOSED_AT + HOUR);
    await runWeather(guild);
    expect(routes(world).filter((r) => r === eventEdit(guild))).toHaveLength(2);
    expect(shown(world, guild).event).toContain("Weather: 26 to 32°F");
  });

  it("unarchives an archived thread to edit its first message, then archives it again", async () => {
    const guild = "200000000000000714";
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    await planHike(guild);
    world.archived = true;
    const before = world.sent.length;
    await runWeather(guild);
    const thread = routes(world)
      .slice(before)
      .filter((r) => r.includes(`/channels/${THREAD}`));
    expect(thread).toEqual([
      THREAD_EDIT,
      `PATCH /channels/${THREAD}`,
      THREAD_EDIT,
      `PATCH /channels/${THREAD}`,
    ]);
    const changes = world.sent
      .filter((r) => r.route === `PATCH /channels/${THREAD}`)
      .map((r) => r.body);
    expect(changes).toEqual([{ archived: false }, { archived: true }]);
    expect(world.archived).toBe(true);
    expect(shown(world, guild).thread).toContain("13:00   32/23  14%");
  });

  it("keeps the edit when archiving the thread again is refused, and leaves it open", async () => {
    const guild = "200000000000000715";
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    await planHike(guild);
    world.archived = true;
    world.archiveRefused = true;
    await runWeather(guild);
    expect(world.archived).toBe(false);
    expect(shown(world, guild).thread).toContain("13:00   32/23  14%");
    // The edit stands, so the next run with the same answer edits nothing.
    const sent = world.sent.length;
    setNow(CLOSED_AT + HOUR);
    await runWeather(guild);
    expect(world.sent).toHaveLength(sent);
  });
});

describe("the hike-day announcement", () => {
  it("fetches the forecast just before posting and sums up the hike's hours", async () => {
    const guild = "200000000000000721";
    setNow(CLOSED_AT);
    const world = stubWorld(guild);
    await planHike(guild);
    await runWeather(guild);
    world.forecast = () =>
      Response.json(
        answerOn("2026-11-21", (answer) => {
          answer.hourly.temperature_2m = answer.hourly.temperature_2m.map(
            (t) => t + 10,
          );
        }),
      );
    // 07:00 in Los Angeles on the day.
    setNow(Date.UTC(2026, 10, 21, 15));
    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    const posted = world.sent.find(
      (r) =>
        r.route === `POST /channels/${NEWS}/messages` &&
        text(r.body.components).includes("Hike today"),
    );
    const lines = text(posted?.body.components).split("\n");
    expect(lines).toContain(
      "**Weather:** 36 to 42°F, up to 31% chance of rain, gusts up to 7 mph",
    );
    expect(lines).toContain(
      "-# [Weather data by Open-Meteo.com](https://open-meteo.com/)",
    );
    expect(lines.some((line) => line.includes("[OpenStreetMap]"))).toBe(true);
    // The fetch came first, and the thread and the event follow on the
    // weather job's run.
    expect(world.asked.length).toBeGreaterThanOrEqual(2);
    expect((await jobs(guild)).get(WEATHER_JOB)).toBeLessThanOrEqual(
      Date.now(),
    );
  });
});

/** A completed round at Paradise, pinned, on `DATE`. */
const round = (over: Partial<RoundView> = {}): RoundView => ({
  id: 1,
  status: "complete",
  locationOptionId: 1,
  dateOptionId: 2,
  threadId: null,
  eventId: null,
  mapPictureKey: null,
  dayOf: null,
  forecast: null,
  startedBy: OWNER,
  startedAt: 0,
  endedBy: OWNER,
  endedAt: 0,
  locationPoll: {
    id: 1,
    roundId: 1,
    kind: "location",
    status: "closed",
    channelId: null,
    messageId: null,
    winnerOptionId: 1,
    tieBroken: false,
    tiedOptionIds: [],
    openedBy: OWNER,
    openedAt: 0,
    closedBy: OWNER,
    closedAt: 0,
    voterCount: 1,
    viewerVotes: [],
    options: [
      {
        id: 1,
        pollId: 1,
        label: "Paradise",
        details: null,
        dateValue: null,
        proposedBy: OWNER,
        createdAt: 0,
        votes: 1,
        place: PINNED,
      },
    ],
  },
  datePoll: {
    id: 2,
    roundId: 1,
    kind: "date",
    status: "closed",
    channelId: null,
    messageId: null,
    winnerOptionId: 2,
    tieBroken: false,
    tiedOptionIds: [],
    openedBy: OWNER,
    openedAt: 0,
    closedBy: OWNER,
    closedAt: 0,
    voterCount: 1,
    viewerVotes: [],
    options: [
      {
        id: 2,
        pollId: 2,
        label: "Sat, 21 Nov 2026 · 13:00",
        details: null,
        dateValue: DATE,
        proposedBy: OWNER,
        createdAt: 0,
        votes: 1,
        place: null,
      },
    ],
  },
  ...over,
});

describe("weatherTexts", () => {
  it("says a forecast is on its way within the 16 days, and that it appears 16 days before further ahead", () => {
    const hike = { start: START, end: END };
    const opens = forecastOpensAt(hike, LA);
    expect(opens).toBe(hikeStart("2026-11-06 00:00", LA));
    expect(withinForecast(hike, LA, opens - 1)).toBe(false);
    expect(withinForecast(hike, LA, opens)).toBe(true);
    expect(weatherTexts(round(), LA, opens - 1)?.thread).toBe(
      `### Weather\n${FORECAST_TOO_FAR}`,
    );
    expect(weatherTexts(round(), LA, opens)?.thread).toBe(
      `### Weather\n${FORECAST_PENDING}`,
    );
    expect(weatherTexts(round(), LA, opens)?.summary).toEqual([
      `**Weather:** ${FORECAST_PENDING}`,
    ]);
  });

  it("does not show a forecast fetched for another pin", async () => {
    const { readForecast } = await import("../../src/weather/open-meteo");
    const forecast = readForecast(answerOn("2026-11-21"), {
      point: { lat: 1, lon: 2 },
      units: "imperial",
    });
    const texts = weatherTexts(
      round({
        forecast: { forecast, fetchedAt: CLOSED_AT, updatedAt: CLOSED_AT },
      }),
      LA,
      CLOSED_AT,
    );
    expect(texts?.event).toBe(`Weather: ${FORECAST_PENDING}`);
  });

  it("is null for a round without a decided date", () => {
    expect(
      weatherTexts(round({ dateOptionId: null }), LA, CLOSED_AT),
    ).toBeNull();
  });
});

describe("Discord's limits", () => {
  /**
   * A forecast with the longest rows: every hour from six hours before the
   * start to six after the end, with three-digit values, the longest
   * conditions, and every note.
   */
  function longest(start: number, end: number): StoredForecast {
    const hours: ForecastHour[] = [];
    // Open-Meteo's hours are whole hours, here in UTC as in Los Angeles.
    const first = Math.floor((start - 6 * HOUR) / HOUR) * HOUR;
    for (let at = first; at <= end + 6 * HOUR; at += HOUR) {
      hours.push({
        at,
        code: 86,
        temperature: -100,
        feelsLike: -110,
        precipitationChance: 100,
        precipitation: 99.99,
        wind: 100,
        gusts: 150,
        snowfall: 99.9,
        freezingLevel: 0,
        uvIndex: 12,
      });
    }
    return {
      forecast: {
        point: PARADISE,
        units: "imperial",
        elevation: 14_411,
        hours,
        days: [{ sunrise: start - 6 * HOUR, sunset: start + 6 * HOUR }],
      },
      fetchedAt: CLOSED_AT,
      updatedAt: CLOSED_AT,
    };
  }

  /** The round with the longest location, details and place name. */
  function longestRound(date: string): RoundView {
    const base = round();
    const start = hikeStart(date, LA);
    const location = base.locationPoll?.options[0];
    const day = base.datePoll?.options[0];
    if (!base.locationPoll || !base.datePoll || !location || !day) {
      throw new Error("no polls");
    }
    return {
      ...base,
      threadId: THREAD,
      eventId: EVENT,
      forecast: longest(start, start + 4 * HOUR),
      locationPoll: {
        ...base.locationPoll,
        options: [
          {
            ...location,
            label: "L".repeat(MAX_LABEL_LENGTH),
            details: "D".repeat(MAX_DETAILS_LENGTH),
            proposedBy: "4".repeat(20),
            votes: 9999,
            place: {
              status: "found",
              point: PARADISE,
              name: "P".repeat(MAX_PLACE_NAME),
              attempts: 1,
            },
          },
        ],
      },
      datePoll: {
        ...base.datePoll,
        options: [
          {
            ...day,
            label: `Sun, 1 Nov 2026 · ${date.slice(11)}`,
            dateValue: date,
          },
        ],
      },
    };
  }

  // A start at half past adds no row: the block always holds the nine
  // hours of its eight, even across the night the clocks go back.
  const DATE_LONGEST = "2026-11-01 00:30";

  it("keeps the thread's first message within 40 components and 4000 characters with the forecast", () => {
    const view = longestRound(DATE_LONGEST);
    const weather = weatherTexts(view, LA, CLOSED_AT)?.thread ?? "";
    expect(weather).toContain("Snowfall:");
    expect(weather).toContain("UV index up to 12 (extreme)");
    expect(weather).toContain("Freezing level down to 0 ft");
    expect(weather.match(/ Heavy snow showers/g)).toHaveLength(9);
    const message = renderThreadMessage(
      view,
      "2".repeat(20),
      LA,
      undefined,
      weather,
    );
    expect(flatten(message as unknown as Node[]).length).toBeLessThanOrEqual(
      40,
    );
    expect(text(message).length).toBeLessThanOrEqual(4000);
    expect(text(message)).toContain(weather);
    expect(text(message)).toContain(`## ${"L".repeat(MAX_LABEL_LENGTH)}`);
  });

  it("keeps the event's description within 1000 characters with the forecast, the map links and the thread link whole", () => {
    const view = longestRound(DATE_LONGEST);
    const weather = weatherTexts(view, LA, CLOSED_AT)?.event ?? "";
    const description = hikeEventDescription(view, "2".repeat(20), weather);
    expect(description.length).toBeLessThanOrEqual(MAX_EVENT_DESCRIPTION);
    expect(description).toContain(weather);
    expect(description).toContain("Google Maps: https://www.google.com/maps/");
    expect(description).toContain(`📍 ${"P".repeat(MAX_PLACE_NAME)}`);
    expect(description).toMatch(
      /Hike thread: https:\/\/discord\.com\/channels\/2{20}\/9\d+$/,
    );
    // The details give way, shortened with "…".
    expect(description).toContain("D…");
  });
});
